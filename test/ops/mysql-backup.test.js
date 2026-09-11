'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { main: backup } = require('../../scripts/backup-mysql');
const { main: restore } = require('../../scripts/restore-mysql');

test('writes an atomic MySQL dump and redacted digest manifest', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mysql-backup-'));
  const output = path.join(root, 'backup.sql');
  let invocation;
  backup(['node', 'backup-mysql.js', '--url', 'mysql://backup_user:secret@127.0.0.1:3306/workbench_test', '--output', output], {
    spawnSyncImpl(bin, args, options) {
      invocation = { bin, args, options };
      return { status: 0, stdout: Buffer.from('CREATE TABLE example (id INT);\n') };
    },
    clock: () => '2026-09-11T00:00:00.000Z'
  });
  assert.equal(fs.existsSync(output), true);
  assert.equal(fs.existsSync(`${output}.partial`), false);
  const manifest = JSON.parse(fs.readFileSync(`${output}.manifest.json`, 'utf8'));
  assert.equal(manifest.database, 'workbench_test');
  assert.equal(manifest.sha256.length, 64);
  assert.equal(invocation.options.env.MYSQL_PWD, 'secret');
  assert.equal(invocation.args.includes('secret'), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('restores only after explicit confirmation and rejects a tampered dump', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mysql-restore-'));
  const input = path.join(root, 'backup.sql');
  backup(['node', 'backup-mysql.js', '--url', 'mysql://user:secret@127.0.0.1:3306/workbench_test', '--output', input], {
    spawnSyncImpl: () => ({ status: 0, stdout: Buffer.from('backup') })
  });
  assert.throws(() => restore(['node', 'restore-mysql.js', '--url', 'mysql://user:secret@127.0.0.1:3306/workbench_test', '--input', input]), /confirm/);
  let called = false;
  restore(['node', 'restore-mysql.js', '--url', 'mysql://user:secret@127.0.0.1:3306/workbench_test', '--input', input, '--confirm'], {
    spawnSyncImpl(_bin, _args, options) { called = true; assert.equal(options.env.MYSQL_PWD, 'secret'); return { status: 0 }; }
  });
  assert.equal(called, true);
  fs.writeFileSync(input, 'tampered');
  assert.throws(() => restore(['node', 'restore-mysql.js', '--url', 'mysql://user:secret@127.0.0.1:3306/workbench_test', '--input', input, '--confirm']), /digest mismatch/);
  fs.rmSync(root, { recursive: true, force: true });
});
