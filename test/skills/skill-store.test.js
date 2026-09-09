'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../../src/db/open-database');
const { migrateDatabase } = require('../../src/db/migrate');
const { createSkillStore } = require('../../src/skills/skill-store');

function insertUser(db, id, role = 'member') {
  db.prepare(`
    INSERT INTO users (
      id, username, display_name, password_hash, role, status, created_at, updated_at
    ) VALUES (?, ?, ?, 'not-a-password', ?, 'active', ?, ?)
  `).run(id, id, id, role, '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z');
}

function useFixture(t, options = {}) {
  const db = openDatabase({ filename: ':memory:' });
  migrateDatabase(db);
  insertUser(db, 'member-1');
  insertUser(db, 'member-2');
  insertUser(db, 'admin-1', 'admin');
  t.after(() => db.close());
  let next = 0;
  const store = createSkillStore(db, {
    idFactory: options.idFactory || (() => `skill-generated-${++next}`),
    clock: options.clock || (() => `2026-09-09T00:00:0${next}.000Z`)
  });
  return { db, store };
}

const memberOne = Object.freeze({ id: 'member-1', role: 'member' });
const memberTwo = Object.freeze({ id: 'member-2', role: 'member' });
const admin = Object.freeze({ id: 'admin-1', role: 'admin' });

test('creates a normalized private draft and its initial version atomically', (t) => {
  const { db, store } = useFixture(t);
  const skill = store.createDraft({
    actor: memberOne,
    slug: ' GPU-Planner ',
    displayName: ' GPU 规划助手 ',
    description: ' 为团队估算容量 ',
    skillMd: '---\nname: gpu-planner\ndescription: Plan GPU capacity\n---\n\n# Instructions\n'
  });

  assert.equal(skill.slug, 'gpu-planner');
  assert.equal(skill.displayName, 'GPU 规划助手');
  assert.equal(skill.description, '为团队估算容量');
  assert.equal(skill.status, 'draft');
  assert.equal(skill.visibility, 'private');
  assert.equal(skill.ownerUserId, memberOne.id);
  assert.equal(skill.version.version, '0.1.0');
  assert.equal(skill.version.status, 'draft');
  assert.match(skill.version.skillMd, /# Instructions/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM skills').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM skill_versions').get().count, 1);
});

test('keeps member drafts private while administrators can govern all drafts', (t) => {
  const { db, store } = useFixture(t);
  const first = store.createDraft({
    actor: memberOne, slug: 'first-skill', displayName: 'First', skillMd: '# First'
  });
  const second = store.createDraft({
    actor: memberTwo, slug: 'second-skill', displayName: 'Second', skillMd: '# Second'
  });

  assert.deepEqual(store.listVisible({ actor: memberOne }).map((item) => item.id), [first.id]);
  assert.deepEqual(store.listVisible({ actor: memberTwo }).map((item) => item.id), [second.id]);
  assert.equal(store.getVisible({ actor: memberTwo, id: first.id }), null);
  assert.deepEqual(new Set(store.listVisible({ actor: admin }).map((item) => item.id)), new Set([first.id, second.id]));
  assert.equal(store.getVisible({ actor: admin, id: first.id }).version.skillMd, '# First');
  assert.equal('skillMd' in store.listVisible({ actor: admin })[0], false);

  db.prepare("UPDATE skills SET visibility = 'team' WHERE id = ?").run(first.id);
  assert.equal(store.getVisible({ actor: memberTwo, id: first.id }), null);
  assert.deepEqual(store.listVisible({ actor: memberTwo, status: 'all' }).map((item) => item.id), [second.id]);

  db.prepare("UPDATE skills SET status = 'published' WHERE id = ?").run(first.id);
  db.prepare("UPDATE skill_versions SET status = 'published' WHERE skill_id = ?").run(first.id);
  assert.equal(store.getVisible({ actor: memberTwo, id: first.id }).id, first.id);
  assert.deepEqual(
    new Set(store.listVisible({ actor: memberTwo, status: 'all' }).map((item) => item.id)),
    new Set([first.id, second.id])
  );
});

test('lists each visible Skill once using only its latest version', (t) => {
  const { db, store } = useFixture(t);
  const created = store.createDraft({
    actor: memberOne, slug: 'versioned-skill', displayName: 'Versioned', skillMd: '# Version 0.1.0'
  });
  db.prepare(`
    INSERT INTO skill_versions (
      id, skill_id, version, status, skill_md, validation_report_json,
      created_by_user_id, created_at, updated_at
    ) VALUES ('version-latest', ?, '0.2.0', 'draft', '# Version 0.2.0', '{}', ?, ?, ?)
  `).run(
    created.id,
    memberOne.id,
    '2026-09-09T01:00:00.000Z',
    '2026-09-09T01:00:00.000Z'
  );

  const listed = store.listVisible({ actor: memberOne, status: 'all' });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, created.id);
  assert.equal(listed[0].version, '0.2.0');
});

test('replaces bounded draft files atomically and invalidates a prior validation report', (t) => {
  const { db, store } = useFixture(t);
  const created = store.createDraft({
    actor: memberOne, slug: 'package-skill', displayName: 'Package', skillMd: '# Package'
  });
  db.prepare(`
    UPDATE skill_versions
    SET status = 'validated', validation_report_json = '{"verdict":"pass"}'
    WHERE id = ?
  `).run(created.version.id);

  const replaced = store.replaceDraftFiles({
    actor: memberOne,
    id: created.id,
    files: [
      { path: 'references/guide.md', content: '# Guide' },
      { path: 'scripts/check.js', content: "console.log('check');" }
    ]
  });

  assert.deepEqual(replaced.files.map((file) => file.path), [
    'references/guide.md', 'scripts/check.js'
  ]);
  assert.equal(replaced.version.status, 'draft');
  assert.deepEqual(replaced.version.validationReport, {});
  assert.equal(replaced.version.contentSha256.length, 64);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM skill_files').get().count, 2);

  const second = store.replaceDraftFiles({
    actor: memberOne,
    id: created.id,
    files: [{ path: 'references/only.md', content: 'Only' }]
  });
  assert.deepEqual(second.files.map((file) => file.path), ['references/only.md']);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM skill_files').get().count, 1);
});

test('rejects unsafe, duplicate, oversized and cross-account Skill package files', (t) => {
  const { db, store } = useFixture(t);
  const created = store.createDraft({
    actor: memberOne, slug: 'safe-package', displayName: 'Safe package', skillMd: '# Safe'
  });

  for (const files of [
    [{ path: '../escape.md', content: 'escape' }],
    [{ path: '/absolute.md', content: 'absolute' }],
    [{ path: 'nested\\windows.md', content: 'windows' }],
    [{ path: '.hidden.md', content: 'hidden' }],
    [{ path: 'binary.txt', content: 'bad\0content' }],
    [{ path: 'unsupported.exe', content: 'unsafe' }],
    [{ path: 'same.md', content: 'first' }, { path: 'same.md', content: 'second' }],
    [{ path: 'huge.md', content: 'x'.repeat(262145) }]
  ]) {
    assert.throws(
      () => store.replaceDraftFiles({ actor: memberOne, id: created.id, files }),
      (error) => error.code === 'INVALID_SKILL_FILES'
    );
  }
  assert.throws(
    () => store.replaceDraftFiles({
      actor: memberOne,
      id: created.id,
      files: Array.from({ length: 65 }, (_, index) => ({ path: `file-${index}.md`, content: 'x' }))
    }),
    (error) => error.code === 'INVALID_SKILL_FILES'
  );
  assert.throws(
    () => store.replaceDraftFiles({
      actor: memberTwo, id: created.id, files: [{ path: 'stolen.md', content: 'stolen' }]
    }),
    (error) => error.code === 'SKILL_NOT_FOUND'
  );

  db.prepare("UPDATE skill_versions SET status = 'published' WHERE id = ?").run(created.version.id);
  assert.throws(
    () => store.replaceDraftFiles({ actor: memberOne, id: created.id, files: [] }),
    (error) => error.code === 'SKILL_NOT_EDITABLE'
  );
});

test('updates only editable draft fields and archives idempotently', (t) => {
  const { store } = useFixture(t);
  const created = store.createDraft({
    actor: memberOne, slug: 'editable-skill', displayName: 'Before', skillMd: '# Before'
  });

  const updated = store.updateDraft({
    actor: memberOne,
    id: created.id,
    displayName: 'After',
    description: 'Updated description',
    skillMd: '# After'
  });
  assert.equal(updated.slug, 'editable-skill');
  assert.equal(updated.displayName, 'After');
  assert.equal(updated.version.skillMd, '# After');
  assert.equal(updated.version.status, 'draft');
  assert.deepEqual(updated.version.validationReport, {});

  const archived = store.archiveDraft({ actor: memberOne, id: created.id });
  assert.equal(archived.status, 'archived');
  assert.equal(store.archiveDraft({ actor: memberOne, id: created.id }).status, 'archived');
  assert.throws(
    () => store.updateDraft({ actor: memberOne, id: created.id, displayName: 'Too late' }),
    (error) => error.code === 'SKILL_NOT_EDITABLE'
  );
  assert.equal(store.listVisible({ actor: memberOne }).length, 0);
  assert.equal(store.listVisible({ actor: memberOne, status: 'archived' })[0].id, created.id);
});

test('rejects conflicts, unsafe input, cross-account writes and rolls back a failed version insert', (t) => {
  const ids = ['skill-1', 'version-shared', 'skill-2', 'version-shared'];
  const { db, store } = useFixture(t, { idFactory: () => ids.shift() });
  const first = store.createDraft({
    actor: memberOne, slug: 'safe-skill', displayName: 'Safe', skillMd: '# Safe'
  });

  assert.throws(
    () => store.createDraft({
      actor: memberTwo, slug: 'SAFE-SKILL', displayName: 'Conflict', skillMd: '# Conflict'
    }),
    (error) => error.code === 'SKILL_SLUG_CONFLICT'
  );
  assert.throws(
    () => store.updateDraft({ actor: memberTwo, id: first.id, displayName: 'Stolen' }),
    (error) => error.code === 'SKILL_NOT_FOUND'
  );
  assert.throws(
    () => store.createDraft({
      actor: memberOne, slug: '../escape', displayName: 'Escape', skillMd: '# Escape'
    }),
    (error) => error.code === 'INVALID_SKILL_SLUG'
  );
  assert.throws(
    () => store.createDraft({
      actor: memberOne, slug: 'huge-skill', displayName: 'Huge', skillMd: 'a'.repeat(262145)
    }),
    (error) => error.code === 'INVALID_SKILL_SOURCE'
  );
  assert.throws(
    () => store.createDraft({
      actor: memberOne, slug: 'rollback-skill', displayName: 'Rollback', skillMd: '# Rollback'
    }),
    /UNIQUE constraint failed/
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM skills WHERE slug = 'rollback-skill'").get().count, 0);
});
