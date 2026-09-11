'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../../src/db/open-database');
const { migrateDatabase } = require('../../src/db/migrate');
const { main: backup } = require('../../scripts/backup-sqlite');
const { main: restore } = require('../../scripts/restore-sqlite');

test('creates and restores an integrity-checked SQLite snapshot without overwriting output', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-backup-'));
  const sourcePath = path.join(root, 'source.db');
  const backupPath = path.join(root, 'backups', 'snapshot.db');
  const restorePath = path.join(root, 'restored', 'workbench.db');
  const attachments = path.join(root, 'attachments');
  const restoredAttachments = path.join(root, 'restored-attachments');
  fs.mkdirSync(path.join(attachments, 'backup-user', 'doc-1'), { recursive: true });
  fs.writeFileSync(path.join(attachments, 'backup-user', 'doc-1', 'guide.md'), '# attachment');
  const db = openDatabase({ filename: sourcePath });
  migrateDatabase(db);
  db.prepare(`INSERT INTO users (id, username, display_name, password_hash, role, status, created_at, updated_at)
    VALUES ('backup-user', 'backup.user', 'Backup User', 'hash', 'member', 'active', ?, ?)`).run('2026-09-11T00:00:00.000Z', '2026-09-11T00:00:00.000Z');
  db.close();

  assert.equal(backup(['node', 'backup-sqlite.js', '--database', sourcePath, '--output', backupPath, '--attachments', attachments]), backupPath);
  assert.equal(restore(['node', 'restore-sqlite.js', '--backup', backupPath, '--output', restorePath, '--attachments', restoredAttachments]), restorePath);
  const restored = openDatabase({ filename: restorePath });
  assert.equal(restored.prepare('SELECT username FROM users WHERE id = ?').get('backup-user').username, 'backup.user');
  restored.close();
  assert.equal(fs.readFileSync(path.join(restoredAttachments, 'backup-user', 'doc-1', 'guide.md'), 'utf8'), '# attachment');
  assert.throws(() => restore(['node', 'restore-sqlite.js', '--backup', backupPath, '--output', restorePath]), /already exists/);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
});

test('rejects a tampered attachment before creating a partial restore', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-backup-tamper-'));
  const sourcePath = path.join(root, 'source.db');
  const backupPath = path.join(root, 'snapshot.db');
  const restorePath = path.join(root, 'restored.db');
  const attachments = path.join(root, 'attachments');
  const restoredAttachments = path.join(root, 'restored-attachments');
  fs.mkdirSync(path.join(attachments, 'user', 'doc'), { recursive: true });
  fs.writeFileSync(path.join(attachments, 'user', 'doc', 'note.txt'), 'original');
  const db = openDatabase({ filename: sourcePath });
  migrateDatabase(db);
  db.close();
  backup(['node', 'backup-sqlite.js', '--database', sourcePath, '--output', backupPath, '--attachments', attachments]);
  fs.writeFileSync(path.join(backupPath + '.attachments', 'user', 'doc', 'note.txt'), 'tampered');
  assert.throws(
    () => restore(['node', 'restore-sqlite.js', '--backup', backupPath, '--output', restorePath, '--attachments', restoredAttachments]),
    /digest mismatch/
  );
  assert.equal(fs.existsSync(restorePath), false);
  assert.equal(fs.existsSync(restoredAttachments), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('cleans a partial snapshot when attachment backup is rejected', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-backup-link-'));
  const sourcePath = path.join(root, 'source.db');
  const backupPath = path.join(root, 'snapshot.db');
  const attachments = path.join(root, 'attachments');
  fs.mkdirSync(attachments, { recursive: true });
  fs.symlinkSync('/tmp', path.join(attachments, 'external'));
  const db = openDatabase({ filename: sourcePath });
  migrateDatabase(db);
  db.close();
  assert.throws(
    () => backup(['node', 'backup-sqlite.js', '--database', sourcePath, '--output', backupPath, '--attachments', attachments]),
    /symbolic links/
  );
  assert.equal(fs.existsSync(backupPath), false);
  assert.equal(fs.existsSync(`${backupPath}.attachments`), false);
  fs.rmSync(root, { recursive: true, force: true });
});
