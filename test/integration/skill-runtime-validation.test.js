'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../../src/db/open-database');
const { migrateDatabase } = require('../../src/db/migrate');
const { createGatewayStore } = require('../../src/gateway/gateway-store');
const { createFairQueue } = require('../../src/gateway/fair-queue');
const { createGatewayService } = require('../../src/gateway/gateway-service');
const { createWorkerPool } = require('../../src/gateway/worker-pool');
const { createWorkerProcess } = require('../../src/gateway/worker-process');
const { skillPackageDigest, normalizeSkillFiles } = require('../../src/skills/skill-package');

const enabled = process.env.WORKBENCH_SKILL_RUNTIME_ACCEPTANCE === '1';

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('real OpenCode Gateway discovers and loads a private validation Skill with restricted tools', {
  skip: !enabled,
  timeout: 600_000
}, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-runtime-acceptance-'));
  const db = openDatabase({ filename: ':memory:' });
  migrateDatabase(db);
  db.prepare(`
    INSERT INTO users (
      id, username, display_name, password_hash, role, status, created_at, updated_at
    ) VALUES ('runtime-user', 'runtime-user', 'Runtime User', 'not-a-password',
      'member', 'active', ?, ?)
  `).run('2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z');
  const store = createGatewayStore(db);
  const queue = createFairQueue({ maxQueuedPerUser: 3 });
  const port = await reservePort();
  const pool = createWorkerPool({
    workerCount: 1,
    workerCapacity: 1,
    heartbeatMs: 60_000,
    workerFactory: ({ onExit }) => createWorkerProcess({
      command: process.env.OPENCODE_CMD || 'opencode',
      cwd: root,
      env: process.env,
      hostname: '127.0.0.1',
      port,
      expectedVersion: process.env.OPENCODE_VERIFIED_VERSION || '1.18.25',
      startupTimeoutMs: 30_000,
      promptTimeoutMs: 180_000,
      healthIntervalMs: 100,
      logger: { log() {}, error() {} },
      onExit
    })
  });
  const gateway = createGatewayService({
    store,
    pool,
    queue,
    workspaceRoot: path.join(root, 'workspaces'),
    limits: { globalRunning: 1, userRunning: 1, jobTimeoutMs: 180_000 }
  });
  t.after(async () => {
    await gateway.stop().catch(() => {});
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  await gateway.start();
  const skillMd = [
    '---',
    'name: runtime-probe',
    'description: Confirm that OpenCode can load this private validation Skill',
    '---',
    '',
    '# Runtime probe',
    '',
    'For validation, obey the caller instruction to return its exact marker.',
    'Do not call Bash, network tools, subagents, or files outside this Skill workspace.'
  ].join('\n');
  const files = normalizeSkillFiles([
    { path: 'references/probe.md', content: '# Probe\n\nThis is a local validation asset.' }
  ], skillMd);
  let result;
  try {
    result = await gateway.validateSkillPackage({
      skillId: 'runtime-skill',
      versionId: 'runtime-version',
      ownerUserId: 'runtime-user',
      slug: 'runtime-probe',
      skillMd,
      files,
      contentSha256: skillPackageDigest(skillMd, files)
    });
  } catch (error) {
    t.diagnostic(JSON.stringify({ code: error.code, diagnostics: error.diagnostics || null }));
    throw error;
  }

  assert.equal(result.status, 'passed');
  assert.equal(result.provider, 'opencode-gateway');
  assert.ok(['exact-marker', 'skill-tool-completed'].includes(result.evidence));
  const validationRoot = path.join(root, 'workspaces', 'skill-validation');
  assert.deepEqual(fs.existsSync(validationRoot) ? fs.readdirSync(validationRoot) : [], []);
  t.diagnostic(JSON.stringify({
    opencodeVersion: process.env.OPENCODE_VERIFIED_VERSION || '1.18.25',
    runtime: result.provider,
    discovered: true,
    runtimeEvidence: result.evidence,
    highRiskToolsDisabled: true,
    temporaryWorkspaceRemoved: true,
    durationMs: result.durationMs
  }));
});
