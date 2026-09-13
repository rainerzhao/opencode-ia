'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { main: backup } = require('../../scripts/backup-mysql');
const { main: restore } = require('../../scripts/restore-mysql');
const tls = require('node:tls');

test('backup and restore preserve mysqls identity verification and the operator CA', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mysql-backup-tls-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ca = path.join(root, 'ca.pem');
  fs.writeFileSync(ca, tls.rootCertificates[0]);
  const env = { WORKBENCH_DATABASE_URL: 'mysqls://user:secret@db.intra.example/workbench_test', MYSQL_SSL_CA_FILE: ca };
  const output = path.join(root, 'backup.sql');
  const invocations = [];
  const spawnSyncImpl = (bin, args, options) => {
    invocations.push({ bin, args, options });
    return { status: 0, stdout: Buffer.from('SELECT 1;') };
  };
  backup(['node', 'backup-mysql.js', '--output', output], { env, spawnSyncImpl });
  restore(['node', 'restore-mysql.js', '--input', output, '--confirm'], { env, spawnSyncImpl });
  assert.equal(invocations.length, 2);
  for (const { args, options } of invocations) {
    assert.ok(args.includes('--ssl-mode=VERIFY_IDENTITY'));
    assert.ok(args.includes(`--ssl-ca=${ca}`));
    assert.ok(args.includes('--protocol=TCP'));
    assert.equal(args.includes('secret'), false);
    assert.equal(options.env.MYSQL_PWD, 'secret');
  }
  fs.writeFileSync(ca, 'invalid');
  assert.throws(() => backup(['node', 'backup-mysql.js', '--output', path.join(root, 'bad.sql')], { env, spawnSyncImpl }), /CA/);
  assert.throws(() => restore(['node', 'restore-mysql.js', '--input', output, '--confirm'], { env, spawnSyncImpl }), /CA/);
  assert.equal(invocations.length, 2);
});

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
  assert.equal(invocation.args.includes('--no-tablespaces'), true);
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

test('backs up Knowledge attachments into an independent sidecar manifest', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mysql-attachments-backup-'));
  const attachments = path.join(root, 'attachments');
  const output = path.join(root, 'backup.sql');
  fs.mkdirSync(path.join(attachments, 'user-a', 'knowledge-1'), { recursive: true });
  fs.writeFileSync(path.join(attachments, 'user-a', 'knowledge-1', 'guide.md'), '# guide');
  fs.writeFileSync(path.join(attachments, 'user-a', 'knowledge-1', 'data.json'), '{"ok":true}');

  backup(['node', 'backup-mysql.js', '--url', 'mysql://user:secret@127.0.0.1:3306/workbench_test', '--output', output, '--attachments', attachments], {
    spawnSyncImpl: () => ({ status: 0, stdout: Buffer.from('backup') })
  });

  const manifest = JSON.parse(fs.readFileSync(`${output}.attachments.manifest.json`, 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(manifest.files.map((file) => file.path), [
    'user-a/knowledge-1/data.json',
    'user-a/knowledge-1/guide.md'
  ]);
  assert.equal(manifest.files.every((file) => file.sha256.length === 64), true);
  assert.equal(fs.readFileSync(path.join(`${output}.attachments`, 'user-a/knowledge-1/guide.md'), 'utf8'), '# guide');
  assert.equal(fs.existsSync(`${output}.manifest.json`), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('rejects symbolic links while backing up MySQL attachments and cleans partial outputs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mysql-attachments-link-'));
  const attachments = path.join(root, 'attachments');
  const output = path.join(root, 'backup.sql');
  fs.mkdirSync(attachments, { recursive: true });
  fs.symlinkSync('/tmp', path.join(attachments, 'external'));
  assert.throws(() => backup(['node', 'backup-mysql.js', '--url', 'mysql://user:secret@127.0.0.1:3306/workbench_test', '--output', output, '--attachments', attachments], {
    spawnSyncImpl: () => ({ status: 0, stdout: Buffer.from('backup') })
  }), /symbolic links/);
  assert.equal(fs.existsSync(output), false);
  assert.equal(fs.existsSync(`${output}.attachments`), false);
  assert.equal(fs.existsSync(`${output}.attachments.manifest.json`), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('restores and verifies MySQL attachment sidecar atomically', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mysql-attachments-restore-'));
  const attachments = path.join(root, 'attachments');
  const output = path.join(root, 'backup.sql');
  const restoredAttachments = path.join(root, 'restored-attachments');
  fs.mkdirSync(path.join(attachments, 'user-a', 'knowledge-1'), { recursive: true });
  fs.writeFileSync(path.join(attachments, 'user-a', 'knowledge-1', 'guide.md'), '# guide');
  backup(['node', 'backup-mysql.js', '--url', 'mysql://user:secret@127.0.0.1:3306/workbench_test', '--output', output, '--attachments', attachments], {
    spawnSyncImpl: () => ({ status: 0, stdout: Buffer.from('backup') })
  });
  let invocation;
  restore(['node', 'restore-mysql.js', '--url', 'mysql://user:secret@127.0.0.1:3306/workbench_test', '--input', output, '--attachments', restoredAttachments, '--confirm'], {
    spawnSyncImpl: (bin, args, options) => {
      invocation = { bin, args, options };
      return { status: 0 };
    }
  });
  assert.equal(fs.readFileSync(path.join(restoredAttachments, 'user-a/knowledge-1/guide.md'), 'utf8'), '# guide');
  assert.equal(invocation.options.env.MYSQL_PWD, 'secret');

  fs.rmSync(restoredAttachments, { recursive: true, force: true });
  fs.writeFileSync(path.join(`${output}.attachments`, 'user-a/knowledge-1/guide.md'), 'tampered');
  assert.throws(() => restore(['node', 'restore-mysql.js', '--url', 'mysql://user:secret@127.0.0.1:3306/workbench_test', '--input', output, '--attachments', restoredAttachments, '--confirm'], {
    spawnSyncImpl: () => ({ status: 0 })
  }), /attachment digest mismatch/);
  assert.equal(fs.existsSync(restoredAttachments), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('rejects attachment manifest path traversal before invoking mysql', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mysql-attachments-path-'));
  const input = path.join(root, 'backup.sql');
  const restoredAttachments = path.join(root, 'restored-attachments');
  backup(['node', 'backup-mysql.js', '--url', 'mysql://user:secret@127.0.0.1:3306/workbench_test', '--output', input], {
    spawnSyncImpl: () => ({ status: 0, stdout: Buffer.from('backup') })
  });
  fs.mkdirSync(`${input}.attachments`, { recursive: true });
  fs.writeFileSync(`${input}.attachments.manifest.json`, JSON.stringify({
    schemaVersion: 1,
    files: [{ path: '../outside.txt', sizeBytes: 1, sha256: '0'.repeat(64) }]
  }));
  let called = false;
  assert.throws(() => restore(['node', 'restore-mysql.js', '--url', 'mysql://user:secret@127.0.0.1:3306/workbench_test', '--input', input, '--attachments', restoredAttachments, '--confirm'], {
    spawnSyncImpl: () => { called = true; return { status: 0 }; }
  }), /manifest path is invalid/);
  assert.equal(called, false);
  fs.rmSync(root, { recursive: true, force: true });
});
