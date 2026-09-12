'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../../src/db/open-database');
const { migrateDatabase } = require('../../src/db/migrate');
const { MIGRATIONS } = require('../../src/db/migrations');

function insertUser(db, id) {
  db.prepare(`
    INSERT INTO users (id, username, display_name, password_hash, role, status, created_at, updated_at)
    VALUES (?, ?, ?, 'not-a-password', 'member', 'active', ?, ?)
  `).run(id, id, id, '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z');
}

test('upgrades the established schema with versioned content and current-version FTS', (t) => {
  const db = openDatabase({ filename: ':memory:' });
  t.after(() => db.close());
  assert.deepEqual(migrateDatabase(db, { migrations: MIGRATIONS.slice(0, 4) }), {
    appliedVersions: [1, 2, 3, 4]
  });
  insertUser(db, 'member-a');

  assert.deepEqual(migrateDatabase(db), { appliedVersions: [5, 6, 7, 8, 9] });
  const details = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'conversation_reference_details'").all();
  assert.equal(details.length, 1);
  assert.equal(details[0].name, 'conversation_reference_details');
  const names = db.prepare(`
    SELECT name FROM sqlite_schema
    WHERE name IN ('knowledge_documents', 'knowledge_versions', 'solutions', 'solution_versions', 'content_references', 'knowledge_fts')
    ORDER BY name
  `).all().map((row) => row.name);
  assert.deepEqual(names, [
    'content_references', 'knowledge_documents', 'knowledge_fts', 'knowledge_versions',
    'solution_versions', 'solutions'
  ]);
  const now = '2026-09-10T00:00:00.000Z';
  db.prepare(`
    INSERT INTO knowledge_documents (
      id, owner_user_id, status, visibility, current_version_id, created_at, updated_at
    ) VALUES ('document-1', 'member-a', 'draft', 'private', NULL, ?, ?)
  `).run(now, now);
  assert.throws(
    () => db.prepare(`
      INSERT INTO knowledge_versions (
        id, document_id, version_number, title, category, tags_json, markdown, is_current, created_at, created_by_user_id
      ) VALUES ('bad-version', 'missing-document', 1, 'GPU', '', '[]', '# GPU', 1, ?, 'member-a')
    `).run(now),
    /FOREIGN KEY constraint failed/
  );
  db.prepare(`
    INSERT INTO knowledge_versions (
      id, document_id, version_number, title, category, tags_json, markdown, is_current, created_at, created_by_user_id
    ) VALUES ('version-1', 'document-1', 1, 'GPU', 'gpu', '["H800"]', '# GPU', 1, ?, 'member-a')
  `).run(now);
  assert.throws(
    () => db.prepare("UPDATE knowledge_documents SET current_version_id = 'missing-version' WHERE id = 'document-1'").run(),
    /FOREIGN KEY constraint failed/
  );
  assert.throws(
    () => db.prepare(`
      INSERT INTO knowledge_versions (
        id, document_id, version_number, title, category, tags_json, markdown, is_current, created_at, created_by_user_id
      ) VALUES ('version-2', 'document-1', 2, 'GPU v2', 'gpu', '[]', '# GPU v2', 1, ?, 'member-a')
    `).run(now),
    /UNIQUE constraint failed/
  );
});
