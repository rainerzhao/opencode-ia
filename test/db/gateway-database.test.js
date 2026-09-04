'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../../src/db/open-database');
const { migrateDatabase } = require('../../src/db/migrate');
const { MIGRATIONS } = require('../../src/db/migrations');

function useDatabase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-db-test-'));
  const db = openDatabase({ filename: path.join(root, 'workbench.db') });
  t.after(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return db;
}

function insertUser(db, id = 'user-1') {
  db.prepare(`
    INSERT INTO users (
      id, username, display_name, password_hash, role, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    id,
    id,
    'not-a-real-password-hash',
    'member',
    'active',
    '2026-09-04T00:00:00.000Z',
    '2026-09-04T00:00:00.000Z'
  );
}

test('upgrades a populated version-1 database with the complete Gateway schema', (t) => {
  const db = useDatabase(t);
  assert.deepEqual(
    migrateDatabase(db, { migrations: [MIGRATIONS[0]] }),
    { appliedVersions: [1] }
  );
  insertUser(db);

  assert.deepEqual(migrateDatabase(db), { appliedVersions: [2] });
  assert.deepEqual(migrateDatabase(db), { appliedVersions: [] });

  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN (
      'conversations', 'opencode_sessions', 'gateway_jobs',
      'gateway_workers', 'gateway_events'
    )
    ORDER BY name
  `).all().map((row) => row.name);
  assert.deepEqual(tables, [
    'conversations',
    'gateway_events',
    'gateway_jobs',
    'gateway_workers',
    'opencode_sessions'
  ]);
  assert.equal(db.prepare('SELECT username FROM users WHERE id = ?').get('user-1').username, 'user-1');
  assert.deepEqual(
    db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => row.version),
    [1, 2]
  );
});

test('enforces Gateway ownership, mapping, idempotency, and status constraints', (t) => {
  const db = useDatabase(t);
  migrateDatabase(db);
  insertUser(db);

  assert.throws(
    () => db.prepare(`
      INSERT INTO conversations (id, owner_user_id, title, status, created_at, updated_at)
      VALUES ('conversation-missing', 'missing-user', 'Private chat', 'active', ?, ?)
    `).run('2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z'),
    /FOREIGN KEY constraint failed/
  );

  db.prepare(`
    INSERT INTO conversations (id, owner_user_id, title, status, created_at, updated_at)
    VALUES ('conversation-1', 'user-1', 'Private chat', 'active', ?, ?)
  `).run('2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z');
  db.prepare(`
    INSERT INTO gateway_workers (
      id, instance_id, status, capacity, created_at, updated_at
    ) VALUES ('worker-1', 'instance-1', 'healthy', 1, ?, ?)
  `).run('2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z');
  db.prepare(`
    INSERT INTO opencode_sessions (
      id, conversation_id, opencode_session_id, worker_id, workspace_path,
      recovery_status, created_at, updated_at
    ) VALUES ('binding-1', 'conversation-1', 'ses_one', 'worker-1',
      '/safe/conversation-1', 'active', ?, ?)
  `).run('2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z');

  assert.throws(
    () => db.prepare(`
      INSERT INTO opencode_sessions (
        id, conversation_id, opencode_session_id, workspace_path,
        recovery_status, created_at, updated_at
      ) VALUES ('binding-2', 'conversation-1', 'ses_two', '/safe/other', 'active', ?, ?)
    `).run('2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z'),
    /UNIQUE constraint failed/
  );

  const insertJob = db.prepare(`
    INSERT INTO gateway_jobs (
      id, conversation_id, user_id, idempotency_key, input_text, status,
      created_at, updated_at
    ) VALUES (?, 'conversation-1', 'user-1', ?, 'hello', 'queued', ?, ?)
  `);
  insertJob.run('job-1', 'request-1', '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z');
  assert.throws(
    () => insertJob.run('job-2', 'request-1', '2026-09-04T00:00:01.000Z', '2026-09-04T00:00:01.000Z'),
    /UNIQUE constraint failed/
  );
  assert.throws(
    () => db.prepare("UPDATE gateway_jobs SET status = 'unknown' WHERE id = 'job-1'").run(),
    /CHECK constraint failed/
  );
});

test('assigns durable monotonically increasing event sequences', (t) => {
  const db = useDatabase(t);
  migrateDatabase(db);
  insertUser(db);
  db.prepare(`
    INSERT INTO conversations (id, owner_user_id, title, status, created_at, updated_at)
    VALUES ('conversation-1', 'user-1', 'Private chat', 'active', ?, ?)
  `).run('2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z');

  const insert = db.prepare(`
    INSERT INTO gateway_events (conversation_id, type, payload_json, created_at)
    VALUES ('conversation-1', ?, '{}', ?)
  `);
  insert.run('conversation.snapshot', '2026-09-04T00:00:00.000Z');
  insert.run('worker.status', '2026-09-04T00:00:01.000Z');

  assert.deepEqual(
    db.prepare('SELECT sequence FROM gateway_events ORDER BY sequence').all().map((row) => row.sequence),
    [1, 2]
  );
});
