'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../../src/db/open-database');
const { migrateDatabase } = require('../../src/db/migrate');
const { MIGRATIONS } = require('../../src/db/migrations');

function insertUser(db) {
  db.prepare(`
    INSERT INTO users (
      id, username, display_name, password_hash, role, status, created_at, updated_at
    ) VALUES ('user-1', 'user-1', 'User 1', 'not-a-password', 'member', 'active', ?, ?)
  `).run('2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z');
}

function insertVersion(db) {
  const now = '2026-09-09T00:00:00.000Z';
  db.prepare(`
    INSERT INTO skills (
      id, owner_user_id, slug, display_name, description, status, visibility,
      created_at, updated_at
    ) VALUES ('skill-1', 'user-1', 'file-skill', 'File Skill', '', 'draft', 'private', ?, ?)
  `).run(now, now);
  db.prepare(`
    INSERT INTO skill_versions (
      id, skill_id, version, status, skill_md, validation_report_json,
      content_sha256, created_by_user_id, created_at, updated_at
    ) VALUES ('version-1', 'skill-1', '0.1.0', 'draft', '# File Skill', '{}', ?, 'user-1', ?, ?)
  `).run('a'.repeat(64), now, now);
}

test('upgrades a populated Stage 4A database with the Skill package file schema', (t) => {
  const db = openDatabase({ filename: ':memory:' });
  t.after(() => db.close());
  assert.deepEqual(migrateDatabase(db, { migrations: MIGRATIONS.slice(0, 3) }), {
    appliedVersions: [1, 2, 3]
  });
  insertUser(db);
  insertVersion(db);

  assert.deepEqual(migrateDatabase(db), { appliedVersions: [4, 5, 6, 7] });
  assert.equal(
    db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'skill_files'").get().name,
    'skill_files'
  );
  assert.equal(db.prepare('SELECT slug FROM skills WHERE id = ?').get('skill-1').slug, 'file-skill');
});

test('enforces version ownership, unique paths, byte bounds and content digests for Skill files', (t) => {
  const db = openDatabase({ filename: ':memory:' });
  t.after(() => db.close());
  migrateDatabase(db);
  insertUser(db);
  insertVersion(db);
  const now = '2026-09-09T00:00:00.000Z';

  db.prepare(`
    INSERT INTO skill_files (
      id, version_id, path, content, size_bytes, content_sha256, created_at, updated_at
    ) VALUES ('file-1', 'version-1', 'references/guide.md', '# Guide', 7, ?, ?, ?)
  `).run('b'.repeat(64), now, now);

  assert.throws(
    () => db.prepare(`
      INSERT INTO skill_files (
        id, version_id, path, content, size_bytes, content_sha256, created_at, updated_at
      ) VALUES ('file-duplicate', 'version-1', 'references/guide.md', 'duplicate', 9, ?, ?, ?)
    `).run('c'.repeat(64), now, now),
    /UNIQUE constraint failed/
  );
  assert.throws(
    () => db.prepare(`
      INSERT INTO skill_files (
        id, version_id, path, content, size_bytes, content_sha256, created_at, updated_at
      ) VALUES ('file-missing', 'version-missing', 'missing.md', 'x', 1, ?, ?, ?)
    `).run('d'.repeat(64), now, now),
    /FOREIGN KEY constraint failed/
  );
  assert.throws(
    () => db.prepare(`
      INSERT INTO skill_files (
        id, version_id, path, content, size_bytes, content_sha256, created_at, updated_at
      ) VALUES ('file-large', 'version-1', 'large.md', 'x', 262145, ?, ?, ?)
    `).run('e'.repeat(64), now, now),
    /CHECK constraint failed/
  );
  assert.throws(
    () => db.prepare(`
      INSERT INTO skill_files (
        id, version_id, path, content, size_bytes, content_sha256, created_at, updated_at
      ) VALUES ('file-digest', 'version-1', 'digest.md', 'x', 1, 'short', ?, ?)
    `).run(now, now),
    /CHECK constraint failed/
  );
});
