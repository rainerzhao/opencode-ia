'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../../src/db/open-database');
const { migrateDatabase } = require('../../src/db/migrate');
const { createFairQueue } = require('../../src/gateway/fair-queue');
const { createGatewayService } = require('../../src/gateway/gateway-service');
const { createGatewayStore } = require('../../src/gateway/gateway-store');
const { createWorkerPool } = require('../../src/gateway/worker-pool');
const { createWorkerProcess } = require('../../src/gateway/worker-process');
const { createSkillInstallationFiles } = require('../../src/skills/skill-installation-files');
const { createSkillInstallationService } = require('../../src/skills/skill-installation-service');
const { createSkillStore } = require('../../src/skills/skill-store');
const { createSkillWorkspaceSync } = require('../../src/skills/skill-workspace-sync');

const enabled = process.env.WORKBENCH_SKILL_VERSION_DISCOVERY_ACCEPTANCE === '1';

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function insertUser(db, id) {
  db.prepare(`INSERT INTO users (id, username, display_name, password_hash, role, status, created_at, updated_at)
    VALUES (?, ?, ?, 'not-a-password', 'member', 'active', ?, ?)`).run(
    id, id, id, '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z'
  );
}

function skillSource(release) {
  return [
    '---', 'name: version-runtime-probe',
    'description: Verify real OpenCode discovers only the selected retained release', '---', '',
    `# Release ${release}`, '', `Exact version marker: ${release}.`
  ].join('\n');
}

function names(value) {
  return (Array.isArray(value) ? value : value.skills || [])
    .map((item) => typeof item === 'string' ? item : item.name || item.id);
}

test('real OpenCode discovers the selected upgraded and rolled-back release, then excludes a disabled Skill', {
  skip: !enabled,
  timeout: 600_000
}, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-version-discovery-'));
  const db = openDatabase({ filename: ':memory:' });
  migrateDatabase(db);
  for (const id of ['version-owner', 'version-member-a', 'version-member-b']) insertUser(db, id);
  let sequence = 0;
  const skills = createSkillStore(db, {
    idFactory: () => `version-discovery-${++sequence}`,
    clock: () => `2026-09-10T00:00:${String(sequence).padStart(2, '0')}.000Z`
  });
  const port = await reservePort();
  let client;
  const pool = createWorkerPool({
    workerCount: 1, workerCapacity: 1, heartbeatMs: 60_000,
    workerFactory: ({ onExit }) => {
      const worker = createWorkerProcess({
        command: process.env.OPENCODE_CMD || 'opencode', cwd: root, env: process.env,
        hostname: '127.0.0.1', port, expectedVersion: process.env.OPENCODE_VERIFIED_VERSION || '1.18.25',
        startupTimeoutMs: 30_000, promptTimeoutMs: 180_000, healthIntervalMs: 100,
        logger: { log() {}, error() {} }, onExit
      });
      client = worker.client;
      return worker;
    }
  });
  const gateway = createGatewayService({
    store: createGatewayStore(db), pool, queue: createFairQueue({ maxQueuedPerUser: 3 }),
    workspaceRoot: path.join(root, 'workspaces'), limits: { globalRunning: 1, userRunning: 1, jobTimeoutMs: 180_000 }
  });
  t.after(async () => { await gateway.stop().catch(() => {}); db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  await gateway.start();

  const owner = { id: 'version-owner', role: 'member' };
  const member = { id: 'version-member-a', role: 'member' };
  const draft = skills.createDraft({ actor: owner, slug: 'version-runtime-probe', displayName: 'Version Runtime Probe', skillMd: skillSource('0.1.0') });
  const validated = skills.saveValidationReport({
    actor: owner, id: draft.id, expectedContentSha256: draft.version.contentSha256,
    report: { schemaVersion: 1, verdict: 'pass', contentSha256: draft.version.contentSha256,
      checks: [], summary: { errors: 0, warnings: 0 }, runtime: { status: 'passed', provider: 'test' } }
  });
  const first = skills.publishValidated({ actor: owner, id: validated.id });
  const installationFiles = createSkillInstallationFiles({ root: path.join(root, 'installations') });
  const workspaceSync = createSkillWorkspaceSync({ installationFiles });
  const service = createSkillInstallationService({
    store: skills, installationFiles,
    runtimeValidator: { async validate(input) { return gateway.validateSkillPackage(input); } }
  });
  service.install({ actor: member, id: first.id });
  await service.enable({ actor: member, id: first.id });

  const successor = skills.createSuccessorDraft({ actor: owner, id: first.id });
  const edited = skills.updateDraft({ actor: owner, id: first.id, skillMd: skillSource('0.2.0') });
  const revalidated = skills.saveValidationReport({
    actor: owner, id: first.id, expectedContentSha256: edited.version.contentSha256,
    report: { schemaVersion: 1, verdict: 'pass', contentSha256: edited.version.contentSha256,
      checks: [], summary: { errors: 0, warnings: 0 }, runtime: { status: 'passed', provider: 'test' } }
  });
  const second = skills.publishValidated({ actor: owner, id: revalidated.id });
  assert.equal(successor.version.id, second.version.id);
  service.upgrade({ actor: member, id: first.id, versionId: second.version.id });
  await service.enable({ actor: member, id: first.id });

  const workspaceA = path.join(root, 'conversations', 'member-a', 'skills-v2');
  const workspaceB = path.join(root, 'conversations', 'member-b');
  workspaceSync.syncEnabledSkills({ userId: member.id, directory: workspaceA, installations: skills.listEnabledInstallations({ userId: member.id }) });
  workspaceSync.syncEnabledSkills({ userId: 'version-member-b', directory: workspaceB, installations: [] });
  assert.ok(names(await client.requestJson('/skill', { directory: workspaceA })).includes(first.slug));
  assert.equal(names(await client.requestJson('/skill', { directory: workspaceB })).includes(first.slug), false);
  assert.match(fs.readFileSync(path.join(workspaceA, '.opencode/skills', first.slug, 'SKILL.md'), 'utf8'), /Exact version marker: 0\.2\.0/);

  service.rollback({ actor: member, id: first.id, versionId: first.version.id });
  await service.enable({ actor: member, id: first.id });
  const rollbackWorkspace = path.join(root, 'conversations', 'member-a', 'skills-v1');
  workspaceSync.syncEnabledSkills({ userId: member.id, directory: rollbackWorkspace, installations: skills.listEnabledInstallations({ userId: member.id }) });
  assert.ok(names(await client.requestJson('/skill', { directory: rollbackWorkspace })).includes(first.slug));
  assert.match(fs.readFileSync(path.join(rollbackWorkspace, '.opencode/skills', first.slug, 'SKILL.md'), 'utf8'), /Exact version marker: 0\.1\.0/);

  skills.disableTeamSkill({ actor: owner, id: first.id });
  const disabledWorkspace = path.join(root, 'conversations', 'member-a', 'skills-disabled');
  workspaceSync.syncEnabledSkills({ userId: member.id, directory: disabledWorkspace, installations: skills.listEnabledInstallations({ userId: member.id }) });
  assert.equal(names(await client.requestJson('/skill', { directory: disabledWorkspace })).includes(first.slug), false);
  t.diagnostic(JSON.stringify({
    opencodeVersion: process.env.OPENCODE_VERIFIED_VERSION || '1.18.25',
    upgradedRelease: second.version.version, rolledBackRelease: first.version.version,
    isolatedMember: 'version-member-b', disabledExcludedFromDiscovery: true
  }));
});
