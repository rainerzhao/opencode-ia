'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMySqlDatabase } = require('../../src/db/mysql-database');
const { migrateMySqlDatabase } = require('../../src/db/mysql-migrate');
const { resetMySqlSchema } = require('../fixtures/mysql-test-database');

const testUrl = process.env.WORKBENCH_TEST_MYSQL_URL;

test('uses a real MySQL 8.4 database with utf8mb4 UTC, ngram and repeatable versioned migrations', { skip: !testUrl }, async (t) => {
  const db = await createMySqlDatabase({ url: testUrl, poolSize: 2 });
  t.after(async () => db.close());

  await resetMySqlSchema(db, { url: testUrl });

  const health = await db.health();
  assert.match(health.version, /^8\.4\./);
  assert.equal(health.characterSet, 'utf8mb4');
  assert.equal(health.timeZone, '+00:00');
  assert.equal(health.ngramParser, true);
  assert.equal(health.ngramTokenSize, 2);
  await assert.doesNotReject(() => db.assertCapabilities());

  const first = await migrateMySqlDatabase(db);
  assert.deepEqual(first.appliedVersions, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(await migrateMySqlDatabase(db), { appliedVersions: [] });

  const secondDb = await createMySqlDatabase({ url: testUrl, poolSize: 1 });
  t.after(async () => secondDb.close());
  let releaseFirstLock;
  const firstLockStarted = new Promise((resolve) => { releaseFirstLock = resolve; });
  let resolveFirstStarted;
  const firstStarted = new Promise((resolve) => { resolveFirstStarted = resolve; });
  const heldLock = db.withMigrationLock(async () => {
    resolveFirstStarted();
    await firstLockStarted;
  });
  await firstStarted;
  let secondEntered = false;
  const waitingLock = secondDb.withMigrationLock(async () => { secondEntered = true; }, { timeoutSeconds: 2 });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(secondEntered, false);
  releaseFirstLock();
  await heldLock;
  await waitingLock;
  assert.equal(secondEntered, true);

  const tables = await db.many(`
    SELECT table_name AS name FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name IN (
      'users', 'login_sessions', 'audit_logs', 'conversations', 'gateway_workers',
      'opencode_sessions', 'gateway_jobs', 'gateway_events', 'skills', 'skill_versions',
      'skill_installations', 'skill_files', 'knowledge_documents', 'knowledge_versions',
    'solutions', 'solution_versions', 'content_references', 'conversation_reference_details', 'content_attachments', 'schema_migrations'
    ) ORDER BY table_name
  `);
  assert.deepEqual(tables.map((row) => row.name), [
    'audit_logs', 'content_attachments', 'content_references', 'conversation_reference_details', 'conversations', 'gateway_events', 'gateway_jobs',
    'gateway_workers', 'knowledge_documents', 'knowledge_versions', 'login_sessions',
    'opencode_sessions', 'schema_migrations', 'skill_files', 'skill_installations',
    'skill_versions', 'skills', 'solution_versions', 'solutions', 'users'
  ]);

  await db.query(`
    INSERT INTO users (id, username, display_name, password_hash, role, status, created_at, updated_at)
    VALUES ('creator-1', 'creator-1', 'Creator', 'hash', 'member', 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
  `);
  await db.query(`
    INSERT INTO knowledge_documents (id, owner_user_id, status, visibility, created_at, updated_at)
    VALUES ('knowledge-1', 'creator-1', 'draft', 'private', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
  `);
  await db.query(`
    INSERT INTO knowledge_versions (
      id, document_id, version_number, title, category, tags_json, markdown,
      is_current, current_document_id, created_at, created_by_user_id
    ) VALUES ('knowledge-version-1', 'knowledge-1', 1, 'Title', '', JSON_ARRAY(), 'Markdown', 1, 'knowledge-1', UTC_TIMESTAMP(3), 'creator-1')
  `);
  await db.query(`
    INSERT INTO content_references (
      id, source_type, source_id, target_type, target_id, knowledge_version_id, solution_version_id, created_at
    ) VALUES ('reference-1', 'conversation', 'conversation-1', 'knowledge_version', 'knowledge-version-1', 'knowledge-version-1', NULL, UTC_TIMESTAMP(3))
  `);
  await assert.rejects(
    () => db.query(`
      INSERT INTO content_references (
        id, source_type, source_id, target_type, target_id, knowledge_version_id, solution_version_id, created_at
      ) VALUES ('reference-2', 'conversation', 'conversation-1', 'knowledge_version', 'knowledge-version-1', 'knowledge-version-1', NULL, UTC_TIMESTAMP(3))
    `),
    (error) => error?.code === 'ER_DUP_ENTRY'
  );
});
