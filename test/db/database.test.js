'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../../src/db/open-database');
const { migrateDatabase } = require('../../src/db/migrate');

function useTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-db-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('opens a WAL database, applies every known migration once, and persists data across reopen', (t) => {
  const root = useTempDir(t);
  const filename = path.join(root, 'nested', 'workbench.db');
  let db = openDatabase({ filename });
  t.after(() => {
    try { db.close(); } catch {}
  });

  const first = migrateDatabase(db);
  assert.deepEqual(first, { appliedVersions: [1, 2] });
  assert.equal(fs.statSync(filename).mode & 0o077, 0);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout, 5000);

  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN ('schema_migrations', 'users', 'login_sessions', 'audit_logs')
    ORDER BY name
  `).all().map((row) => row.name);
  assert.deepEqual(tables, ['audit_logs', 'login_sessions', 'schema_migrations', 'users']);
  assert.deepEqual(migrateDatabase(db), { appliedVersions: [] });

  db.prepare(`
    INSERT INTO users (
      id, username, display_name, password_hash, role, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'user-1',
    'admin',
    'Administrator',
    'not-a-real-password-hash',
    'admin',
    'active',
    '2026-09-01T00:00:00.000Z',
    '2026-09-01T00:00:00.000Z'
  );
  db.close();

  db = openDatabase({ filename });
  migrateDatabase(db);
  const persisted = db.prepare('SELECT username, role, status FROM users WHERE id = ?').get('user-1');
  assert.deepEqual({ ...persisted }, { username: 'admin', role: 'admin', status: 'active' });
});

test('rolls back a migration batch when a later migration fails', (t) => {
  const filename = path.join(useTempDir(t), 'workbench.db');
  const db = openDatabase({ filename });
  t.after(() => db.close());

  assert.throws(
    () => migrateDatabase(db, {
      migrations: [
        { version: 1, sql: 'CREATE TABLE should_rollback (id TEXT PRIMARY KEY);' },
        { version: 2, sql: 'THIS IS NOT SQL;' }
      ]
    }),
    /migration 2 failed/i
  );

  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'should_rollback'").get();
  assert.equal(table, undefined);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 0);
});

test('refuses to run older application code against a newer database schema', (t) => {
  const filename = path.join(useTempDir(t), 'workbench.db');
  const db = openDatabase({ filename });
  t.after(() => db.close());
  migrateDatabase(db);
  db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
    .run(99, '2026-09-01T08:00:00.000Z');

  assert.throws(
    () => migrateDatabase(db),
    (error) => error.code === 'DATABASE_SCHEMA_TOO_NEW'
  );
});
