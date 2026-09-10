'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../../src/db/open-database');
const { migrateDatabase } = require('../../src/db/migrate');
const { createSkillStore } = require('../../src/skills/skill-store');
const { createSkillInstallationFiles } = require('../../src/skills/skill-installation-files');
const { createSkillInstallationService } = require('../../src/skills/skill-installation-service');

const owner = Object.freeze({ id: 'owner-1', role: 'member' });
const member = Object.freeze({ id: 'member-2', role: 'member' });

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-installation-service-'));
  const db = openDatabase({ filename: ':memory:' });
  migrateDatabase(db);
  for (const actor of [owner, member]) {
    db.prepare(`INSERT INTO users (id, username, display_name, password_hash, role, status, created_at, updated_at)
      VALUES (?, ?, ?, 'not-a-password', ?, 'active', ?, ?)`)
      .run(actor.id, actor.id, actor.id, actor.role, '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z');
  }
  let sequence = 0;
  const store = createSkillStore(db, {
    idFactory: () => `generated-${++sequence}`,
    clock: () => `2026-09-10T00:00:${String(sequence).padStart(2, '0')}.000Z`
  });
  const draft = store.createDraft({
    actor: owner, slug: 'installable-skill', displayName: 'Installable',
    skillMd: '---\nname: installable-skill\ndescription: Installable Skill\n---\n\n# Instructions\n'
  });
  const validated = store.saveValidationReport({
    actor: owner, id: draft.id, expectedContentSha256: draft.version.contentSha256,
    report: {
      schemaVersion: 1, verdict: 'pass', contentSha256: draft.version.contentSha256,
      checks: [], summary: { errors: 0, warnings: 0 },
      runtime: { status: 'passed', provider: 'opencode-gateway' }
    }
  });
  const published = store.publishValidated({ actor: owner, id: validated.id });
  const installationFiles = createSkillInstallationFiles({ root: path.join(root, 'installations') });
  t.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, store, installationFiles, published };
}

test('installs a current published package and compensates the filesystem when persistence fails', (t) => {
  const { root, store, installationFiles, published } = fixture(t);
  const service = createSkillInstallationService({
    store, installationFiles,
    runtimeValidator: { async validate() { return { status: 'passed' }; } }
  });
  const installed = service.install({ actor: member, id: published.id });
  assert.equal(installed.status, 'installed');
  assert.equal(fs.existsSync(path.join(root, 'installations', member.id, published.slug, 'SKILL.md')), true);

  const failingFiles = createSkillInstallationFiles({ root: path.join(root, 'failing-installations') });
  const failingService = createSkillInstallationService({
    installationFiles: failingFiles,
    runtimeValidator: { async validate() { return { status: 'passed' }; } },
    store: {
      getPublishedInstallCandidate() { return published; },
      recordInstallation() { throw new Error('database unavailable'); },
      listInstallations() { return []; },
      setInstallationStatus() { throw new Error('not reached'); }
    }
  });
  assert.throws(() => failingService.install({ actor: member, id: published.id }), /database unavailable/);
  assert.equal(fs.existsSync(path.join(root, 'failing-installations', member.id, published.slug)), false);
});

test('enables only after the OpenCode runtime validates the installed package', async (t) => {
  const { store, installationFiles, published } = fixture(t);
  const failures = [];
  const service = createSkillInstallationService({
    store, installationFiles,
    runtimeValidator: {
      async validate(input) {
        failures.push(input);
        return { status: 'failed', code: 'SKILL_RUNTIME_DISCOVERY_FAILED' };
      }
    }
  });
  service.install({ actor: member, id: published.id });
  await assert.rejects(
    service.enable({ actor: member, id: published.id }),
    (error) => error.code === 'SKILL_ENABLE_VALIDATION_FAILED'
  );
  assert.equal(store.listInstallations({ actor: member })[0].status, 'installed');
  assert.equal(failures[0].ownerUserId, member.id);
  assert.equal(failures[0].slug, published.slug);
  assert.equal(failures[0].contentSha256, published.version.contentSha256);

  const passingService = createSkillInstallationService({
    store, installationFiles,
    runtimeValidator: { async validate() { return { status: 'passed', evidence: 'skill-tool-completed' }; } }
  });
  const enabled = await passingService.enable({ actor: member, id: published.id });
  assert.equal(enabled.status, 'enabled');
  assert.equal(store.listEnabledInstallations({ userId: member.id })[0].skillId, published.id);
});

test('does not enable an uninstalled or no-longer-published Skill', async (t) => {
  const { store, installationFiles, published } = fixture(t);
  const service = createSkillInstallationService({
    store, installationFiles,
    runtimeValidator: { async validate() { return { status: 'passed' }; } }
  });
  await assert.rejects(
    service.enable({ actor: member, id: published.id }),
    (error) => error.code === 'SKILL_INSTALLATION_NOT_FOUND'
  );
});
