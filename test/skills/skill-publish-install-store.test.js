'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../../src/db/open-database');
const { migrateDatabase } = require('../../src/db/migrate');
const { createSkillStore } = require('../../src/skills/skill-store');

const owner = Object.freeze({ id: 'owner-1', role: 'member' });
const sibling = Object.freeze({ id: 'member-2', role: 'member' });
const admin = Object.freeze({ id: 'admin-1', role: 'admin' });

function insertUser(db, actor) {
  db.prepare(`
    INSERT INTO users (
      id, username, display_name, password_hash, role, status, created_at, updated_at
    ) VALUES (?, ?, ?, 'not-a-password', ?, 'active', ?, ?)
  `).run(actor.id, actor.id, actor.id, actor.role, '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z');
}

function fixture(t) {
  const db = openDatabase({ filename: ':memory:' });
  migrateDatabase(db);
  [owner, sibling, admin].forEach((actor) => insertUser(db, actor));
  t.after(() => db.close());
  let sequence = 0;
  const store = createSkillStore(db, {
    idFactory: () => `generated-${++sequence}`,
    clock: () => `2026-09-09T00:00:${String(sequence).padStart(2, '0')}.000Z`
  });
  return { db, store };
}

function createValidated(store, actor = owner, slug = 'team-helper') {
  const draft = store.createDraft({
    actor,
    slug,
    displayName: 'Team Helper',
    skillMd: `---\nname: ${slug}\ndescription: Help the team\n---\n\n# Instructions\n`
  });
  return store.saveValidationReport({
    actor,
    id: draft.id,
    expectedContentSha256: draft.version.contentSha256,
    report: {
      schemaVersion: 1,
      verdict: 'pass',
      contentSha256: draft.version.contentSha256,
      checks: [],
      summary: { errors: 0, warnings: 0 },
      runtime: { status: 'passed', provider: 'opencode-gateway' }
    }
  });
}

test('owner publishes only a current validated package and makes it immutable and team-visible', (t) => {
  const { store } = fixture(t);
  const validated = createValidated(store);

  const published = store.publishValidated({ actor: owner, id: validated.id });

  assert.equal(published.status, 'published');
  assert.equal(published.visibility, 'team');
  assert.equal(published.version.status, 'published');
  assert.match(published.version.publishedAt, /^2026-/);
  assert.equal(store.getVisible({ actor: sibling, id: published.id }).id, published.id);
  assert.throws(
    () => store.updateDraft({ actor: owner, id: published.id, displayName: 'Changed' }),
    (error) => error.code === 'SKILL_NOT_EDITABLE'
  );
});

test('administrator may publish but another member cannot discover a private draft', (t) => {
  const { store } = fixture(t);
  const first = createValidated(store, owner, 'admin-publish');
  assert.throws(
    () => store.publishValidated({ actor: sibling, id: first.id }),
    (error) => error.code === 'SKILL_NOT_FOUND'
  );
  assert.equal(store.publishValidated({ actor: admin, id: first.id }).status, 'published');
});

test('rejects draft, failed and stale validation reports without changing visibility', (t) => {
  const { db, store } = fixture(t);
  const draft = store.createDraft({
    actor: owner, slug: 'not-ready', displayName: 'Not ready', skillMd: '# Draft'
  });
  assert.throws(
    () => store.publishValidated({ actor: owner, id: draft.id }),
    (error) => error.code === 'SKILL_NOT_PUBLISHABLE'
  );

  const stale = createValidated(store, owner, 'stale-report');
  const report = stale.version.validationReport;
  db.prepare('UPDATE skill_versions SET validation_report_json = ? WHERE id = ?')
    .run(JSON.stringify({ ...report, contentSha256: '0'.repeat(64) }), stale.version.id);
  assert.throws(
    () => store.publishValidated({ actor: owner, id: stale.id }),
    (error) => error.code === 'SKILL_NOT_PUBLISHABLE'
  );
  assert.equal(store.getVisible({ actor: owner, id: stale.id }).visibility, 'private');
});

test('members install a published version only for themselves and repeated install is idempotent', (t) => {
  const { store } = fixture(t);
  const published = store.publishValidated({ actor: owner, id: createValidated(store).id });
  const candidate = store.getPublishedInstallCandidate({ actor: sibling, id: published.id });
  assert.equal(candidate.version.id, published.version.id);
  assert.equal(candidate.version.skillMd, published.version.skillMd);

  const first = store.recordInstallation({
    actor: sibling,
    skillId: published.id,
    versionId: published.version.id
  });
  const second = store.recordInstallation({
    actor: sibling,
    skillId: published.id,
    versionId: published.version.id
  });
  assert.equal(first.id, second.id);
  assert.equal(first.status, 'installed');
  assert.equal(first.userId, sibling.id);
  assert.deepEqual(store.listInstallations({ actor: sibling }), [first]);
  assert.deepEqual(store.listInstallations({ actor: owner }), []);
});

test('installation state is account-scoped and accepts only the lifecycle statuses', (t) => {
  const { store } = fixture(t);
  const published = store.publishValidated({ actor: owner, id: createValidated(store).id });
  store.recordInstallation({ actor: sibling, skillId: published.id, versionId: published.version.id });

  assert.equal(store.setInstallationStatus({
    actor: sibling, skillId: published.id, status: 'enabled'
  }).status, 'enabled');
  assert.equal(store.listEnabledInstallations({ userId: sibling.id })[0].slug, published.slug);
  assert.deepEqual(store.listEnabledInstallations({ userId: owner.id }), []);
  assert.throws(
    () => store.setInstallationStatus({ actor: sibling, skillId: published.id, status: 'broken' }),
    (error) => error.code === 'INVALID_SKILL_INSTALLATION_STATUS'
  );
  assert.throws(
    () => store.setInstallationStatus({ actor: owner, skillId: published.id, status: 'enabled' }),
    (error) => error.code === 'SKILL_INSTALLATION_NOT_FOUND'
  );
});

test('unpublished and mismatched versions cannot be installed', (t) => {
  const { store } = fixture(t);
  const draft = store.createDraft({
    actor: owner, slug: 'private-only', displayName: 'Private', skillMd: '# Private'
  });
  assert.throws(
    () => store.getPublishedInstallCandidate({ actor: sibling, id: draft.id }),
    (error) => error.code === 'SKILL_NOT_FOUND'
  );
  assert.throws(
    () => store.recordInstallation({ actor: sibling, skillId: draft.id, versionId: draft.version.id }),
    (error) => error.code === 'SKILL_NOT_INSTALLABLE'
  );
});
