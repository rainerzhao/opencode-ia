'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../../src/db/open-database');
const { migrateDatabase } = require('../../src/db/migrate');
const { MIGRATIONS } = require('../../src/db/migrations');

function insertUser(db, id = 'user-1') {
  db.prepare(`
    INSERT INTO users (
      id, username, display_name, password_hash, role, status, created_at, updated_at
    ) VALUES (?, ?, ?, 'not-a-password', 'member', 'active', ?, ?)
  `).run(id, id, id, '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z');
}

test('upgrades a populated Stage 2 database with the complete Skill lifecycle schema', (t) => {
  const db = openDatabase({ filename: ':memory:' });
  t.after(() => db.close());
  assert.deepEqual(migrateDatabase(db, { migrations: MIGRATIONS.slice(0, 2) }), {
    appliedVersions: [1, 2]
  });
  insertUser(db);

  assert.deepEqual(migrateDatabase(db), { appliedVersions: [3, 4, 5] });
  const tables = db.prepare(`
    SELECT name FROM sqlite_schema
    WHERE type = 'table' AND name IN ('skills', 'skill_versions', 'skill_installations')
    ORDER BY name
  `).all().map((row) => row.name);
  assert.deepEqual(tables, ['skill_installations', 'skill_versions', 'skills']);
  assert.equal(db.prepare('SELECT username FROM users WHERE id = ?').get('user-1').username, 'user-1');
});

test('enforces Skill ownership, version, installation and lifecycle constraints', (t) => {
  const db = openDatabase({ filename: ':memory:' });
  t.after(() => db.close());
  migrateDatabase(db);
  insertUser(db);
  insertUser(db, 'user-2');
  const now = '2026-09-09T00:00:00.000Z';

  db.prepare(`
    INSERT INTO skills (
      id, owner_user_id, slug, display_name, description, status, visibility,
      created_at, updated_at
    ) VALUES ('skill-1', 'user-1', 'gpu-planner', 'GPU Planner', 'Plan GPU capacity',
      'draft', 'private', ?, ?)
  `).run(now, now);
  db.prepare(`
    INSERT INTO skill_versions (
      id, skill_id, version, status, skill_md, validation_report_json,
      created_by_user_id, created_at, updated_at
    ) VALUES ('version-1', 'skill-1', '0.1.0', 'draft', '# GPU Planner', '{}',
      'user-1', ?, ?)
  `).run(now, now);
  db.prepare(`
    INSERT INTO skill_installations (
      id, user_id, skill_id, version_id, status, created_at, updated_at
    ) VALUES ('install-1', 'user-2', 'skill-1', 'version-1', 'installed', ?, ?)
  `).run(now, now);

  assert.throws(
    () => db.prepare("UPDATE skills SET status = 'unknown' WHERE id = 'skill-1'").run(),
    /CHECK constraint failed/
  );
  assert.throws(
    () => db.prepare("UPDATE skill_versions SET status = 'unknown' WHERE id = 'version-1'").run(),
    /CHECK constraint failed/
  );
  assert.throws(
    () => db.prepare(`
      INSERT INTO skill_versions (
        id, skill_id, version, status, skill_md, validation_report_json,
        created_by_user_id, created_at, updated_at
      ) VALUES ('version-2', 'skill-1', '0.1.0', 'draft', '# Duplicate', '{}',
        'user-1', ?, ?)
    `).run(now, now),
    /UNIQUE constraint failed/
  );
  assert.throws(
    () => db.prepare(`
      INSERT INTO skill_installations (
        id, user_id, skill_id, version_id, status, created_at, updated_at
      ) VALUES ('install-2', 'user-2', 'skill-1', 'version-1', 'enabled', ?, ?)
    `).run(now, now),
    /UNIQUE constraint failed/
  );
  db.prepare(`
    INSERT INTO skills (
      id, owner_user_id, slug, display_name, description, status, visibility,
      created_at, updated_at
    ) VALUES ('skill-2', 'user-1', 'second-skill', 'Second', '',
      'published', 'team', ?, ?)
  `).run(now, now);
  assert.throws(
    () => db.prepare(`
      INSERT INTO skill_installations (
        id, user_id, skill_id, version_id, status, created_at, updated_at
      ) VALUES ('install-mismatch', 'user-1', 'skill-2', 'version-1', 'installed', ?, ?)
    `).run(now, now),
    /FOREIGN KEY constraint failed/
  );
  assert.throws(
    () => db.prepare(`
      INSERT INTO skills (
        id, owner_user_id, slug, display_name, description, status, visibility,
        created_at, updated_at
      ) VALUES ('skill-missing-owner', 'missing-user', 'missing-owner', 'Missing', '',
        'draft', 'private', ?, ?)
    `).run(now, now),
    /FOREIGN KEY constraint failed/
  );
});
