'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../../src/db/open-database');
const { migrateDatabase } = require('../../src/db/migrate');
const { createSkillStore } = require('../../src/skills/skill-store');

const owner = Object.freeze({ id: 'owner-4d', role: 'member' });
const member = Object.freeze({ id: 'member-4d', role: 'member' });
const admin = Object.freeze({ id: 'admin-4d', role: 'admin' });

function fixture(t) {
  const db = openDatabase({ filename: ':memory:' });
  migrateDatabase(db);
  for (const actor of [owner, member, admin]) {
    db.prepare(`INSERT INTO users (id, username, display_name, password_hash, role, status, created_at, updated_at)
      VALUES (?, ?, ?, 'not-a-password', ?, 'active', ?, ?)`).run(
      actor.id, actor.id, actor.id, actor.role, '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z'
    );
  }
  let sequence = 0;
  const store = createSkillStore(db, {
    idFactory: () => `version-governance-${++sequence}`,
    clock: () => `2026-09-10T00:00:${String(sequence).padStart(2, '0')}.000Z`
  });
  t.after(() => db.close());
  return { db, store };
}

function validated(store, skill, actor = owner) {
  return store.saveValidationReport({
    actor, id: skill.id, expectedContentSha256: skill.version.contentSha256,
    report: {
      schemaVersion: 1, verdict: 'pass', contentSha256: skill.version.contentSha256,
      checks: [], summary: { errors: 0, warnings: 0 }, runtime: { status: 'passed', provider: 'test' }
    }
  });
}

function publishedFixture(store) {
  const draft = store.createDraft({
    actor: owner, slug: 'versioned-team-skill', displayName: 'Versioned Team Skill',
    skillMd: '# Release 0.1.0'
  });
  return store.publishValidated({ actor: owner, id: validated(store, draft).id });
}

test('keeps a published release team-visible while the owner edits a private successor draft', (t) => {
  const { store } = fixture(t);
  const first = publishedFixture(store);

  const successor = store.createSuccessorDraft({ actor: owner, id: first.id });
  assert.equal(successor.status, 'published');
  assert.equal(successor.version.version, '0.2.0');
  assert.equal(successor.version.status, 'draft');
  assert.equal(successor.version.skillMd, '# Release 0.1.0');

  const edited = store.updateDraft({ actor: owner, id: first.id, skillMd: '# Release 0.2.0' });
  assert.equal(edited.version.version, '0.2.0');
  assert.equal(store.getVisible({ actor: member, id: first.id }).version.version, '0.1.0');
  assert.equal(store.getVisible({ actor: member, id: first.id }).version.skillMd, '# Release 0.1.0');
  assert.equal(store.listVisible({ actor: owner, status: 'published' })[0].version, '0.1.0');
  assert.throws(
    () => store.createSuccessorDraft({ actor: member, id: first.id }),
    (error) => error.code === 'SKILL_NOT_FOUND'
  );
});

test('publishes a validated successor, retains the prior release, and keeps member selection explicit', (t) => {
  const { store } = fixture(t);
  const first = publishedFixture(store);
  store.recordInstallation({ actor: member, skillId: first.id, versionId: first.version.id });
  store.setInstallationStatus({ actor: member, skillId: first.id, status: 'enabled' });

  const draft = store.createSuccessorDraft({ actor: owner, id: first.id });
  store.updateDraft({ actor: owner, id: first.id, skillMd: '# Release 0.2.0' });
  const second = store.publishValidated({ actor: owner, id: validated(store, store.getVisible({ actor: owner, id: first.id })).id });

  assert.equal(second.version.version, '0.2.0');
  assert.equal(store.getVisible({ actor: member, id: first.id }).version.version, '0.2.0');
  assert.equal(store.listInstallations({ actor: member })[0].versionId, first.version.id);
  assert.equal(store.listInstallations({ actor: member })[0].status, 'enabled');
  assert.deepEqual(
    store.listReleaseVersions({ actor: member, id: first.id }).map((item) => [item.version, item.status]),
    [['0.2.0', 'published'], ['0.1.0', 'retired']]
  );
  assert.equal(draft.version.id !== second.version.id, false);
});

test('allows an owner to disable and then archive a team Skill without deleting release history', (t) => {
  const { store } = fixture(t);
  const skill = publishedFixture(store);
  store.recordInstallation({ actor: member, skillId: skill.id, versionId: skill.version.id });
  store.setInstallationStatus({ actor: member, skillId: skill.id, status: 'enabled' });

  const disabled = store.disableTeamSkill({ actor: owner, id: skill.id });
  assert.equal(disabled.status, 'disabled');
  assert.equal(store.listInstallations({ actor: member })[0].status, 'disabled');
  assert.deepEqual(store.listEnabledInstallations({ userId: member.id }), []);
  assert.throws(
    () => store.getPublishedInstallCandidate({ actor: member, id: skill.id }),
    (error) => error.code === 'SKILL_NOT_FOUND'
  );

  const archived = store.archiveTeamSkill({ actor: admin, id: skill.id });
  assert.equal(archived.status, 'archived');
  assert.equal(store.getVisible({ actor: member, id: skill.id }), null);
  assert.deepEqual(store.listReleaseVersions({ actor: owner, id: skill.id }).map((item) => item.version), ['0.1.0']);
});
