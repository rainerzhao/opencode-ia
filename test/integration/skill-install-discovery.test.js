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

const enabled = process.env.WORKBENCH_SKILL_INSTALL_DISCOVERY_ACCEPTANCE === '1';

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

test('real OpenCode discovers an enabled installation only in that member workspace', {
  skip: !enabled,
  timeout: 600_000
}, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-install-discovery-'));
  const db = openDatabase({ filename: ':memory:' });
  migrateDatabase(db);
  insertUser(db, 'skill-owner');
  insertUser(db, 'member-a');
  insertUser(db, 'member-b');
  let sequence = 0;
  const skills = createSkillStore(db, {
    idFactory: () => `skill-install-${++sequence}`,
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
    workspaceRoot: path.join(root, 'workspaces'),
    limits: { globalRunning: 1, userRunning: 1, jobTimeoutMs: 180_000 }
  });
  t.after(async () => { await gateway.stop().catch(() => {}); db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  await gateway.start();

  const owner = { id: 'skill-owner', role: 'member' };
  const memberA = { id: 'member-a', role: 'member' };
  const draft = skills.createDraft({
    actor: owner, slug: 'installed-runtime-probe', displayName: 'Installed Runtime Probe',
    skillMd: [
      '---', 'name: installed-runtime-probe',
      'description: Confirm a member installed Skill is discovered only in the intended workspace', '---', '',
      '# Installed runtime probe', '', 'Load this Skill when the caller requests its exact name.'
    ].join('\n')
  });
  const validated = skills.saveValidationReport({
    actor: owner, id: draft.id, expectedContentSha256: draft.version.contentSha256,
    report: { schemaVersion: 1, verdict: 'pass', contentSha256: draft.version.contentSha256,
      checks: [], summary: { errors: 0, warnings: 0 }, runtime: { status: 'passed', provider: 'opencode-gateway' } }
  });
  const published = skills.publishValidated({ actor: owner, id: validated.id });
  const installationFiles = createSkillInstallationFiles({ root: path.join(root, 'installations') });
  const workspaceSync = createSkillWorkspaceSync({ installationFiles });
  let runtimeEvidence;
  const service = createSkillInstallationService({
    store: skills,
    installationFiles,
    runtimeValidator: {
      async validate(input) {
        const result = await gateway.validateSkillPackage(input);
        runtimeEvidence = result.evidence;
        return result;
      }
    }
  });

  service.install({ actor: memberA, id: published.id });
  const enabledInstallation = await service.enable({ actor: memberA, id: published.id });
  assert.equal(enabledInstallation.status, 'enabled');
  assert.ok(['exact-marker', 'skill-tool-completed'].includes(runtimeEvidence));

  const workspaceA = path.join(root, 'conversations', 'member-a');
  const workspaceB = path.join(root, 'conversations', 'member-b');
  workspaceSync.syncEnabledSkills({
    userId: memberA.id, directory: workspaceA,
    installations: skills.listEnabledInstallations({ userId: memberA.id })
  });
  workspaceSync.syncEnabledSkills({ userId: 'member-b', directory: workspaceB, installations: [] });
  const catalogA = await client.requestJson('/skill', { directory: workspaceA });
  const catalogB = await client.requestJson('/skill', { directory: workspaceB });
  const names = (value) => (Array.isArray(value) ? value : value.skills || [])
    .map((item) => typeof item === 'string' ? item : item.name || item.id);
  assert.ok(names(catalogA).includes(published.slug));
  assert.equal(names(catalogB).includes(published.slug), false);
  t.diagnostic(JSON.stringify({
    opencodeVersion: process.env.OPENCODE_VERIFIED_VERSION || '1.18.25',
    runtimeEvidence, enabledMember: memberA.id, uninstalledMember: 'member-b',
    discoveredOnlyForEnabledMember: true
  }));
});
