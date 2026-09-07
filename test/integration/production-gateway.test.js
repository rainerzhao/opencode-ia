'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProductionWorkbench } = require('../../apps/server');
const { openDatabase } = require('../../src/db/open-database');
const { migrateDatabase } = require('../../src/db/migrate');
const { createGatewayStore } = require('../../src/gateway/gateway-store');

test('production lifecycle starts and stops two persistent Gateway workers', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'production-gateway-'));
  const starts = [];
  const stops = [];
  const workbench = createProductionWorkbench({
    projectDir: root,
    env: {
      HOME: root,
      WORKBENCH_ROOT: root,
      WEB_DIST_DIR: path.join(root, 'web'),
      OPENCODE_CMD: '/unused/opencode',
      OPENCODE_CWD: root,
      COOKIE_SECURE: 'false'
    },
    logger: { log() {}, error() {} },
    workerFactory({ id, onExit }) {
      return {
        client: {
          createSession: async () => ({ id: `session-${id}` }),
          prompt: async () => ({ parts: [{ type: 'text', text: 'ok' }] }),
          abortSession: async () => ({})
        },
        async start() {
          starts.push(id);
          return { status: 'healthy' };
        },
        async stop() {
          stops.push(id);
          return { status: 'stopped' };
        },
        async health() { return { healthy: true }; },
        snapshot() {
          return { status: 'healthy', endpoint: `http://127.0.0.1/${id}`, version: '1.18.25' };
        },
        onExit
      };
    }
  });
  t.after(async () => {
    await workbench.stop().catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  });

  await workbench.start(0, '127.0.0.1');

  assert.deepEqual(starts, ['worker-1', 'worker-2']);
  assert.equal(workbench.gatewayService.snapshot().status, 'running');
  assert.equal(workbench.gatewayService.snapshot().pool.workers.length, 2);

  await workbench.stop();
  assert.deepEqual(stops, ['worker-1', 'worker-2']);
  assert.equal(workbench.gatewayService.snapshot().status, 'stopped');
});

test('production startup restores queued jobs and never replays an unknown running job', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'production-recovery-'));
  const databasePath = path.join(root, 'data', 'workbench.db');
  const seedDb = openDatabase({ filename: databasePath });
  migrateDatabase(seedDb);
  const now = '2026-09-07T03:00:00.000Z';
  seedDb.prepare(`
    INSERT INTO users (
      id, username, display_name, password_hash, role, status, created_at, updated_at
    ) VALUES (?, ?, ?, 'not-a-password', 'member', 'active', ?, ?)
  `).run('user-1', 'user-1', 'User 1', now, now);
  let id = 0;
  const seedStore = createGatewayStore(seedDb, { idFactory: () => `seed-${++id}` });
  const conversation = seedStore.createConversation({ ownerUserId: 'user-1', title: 'Recovered work' });
  const unknown = seedStore.createJob({
    conversationId: conversation.id, userId: 'user-1', idempotencyKey: 'unknown', inputText: 'must not replay'
  });
  seedStore.transitionJob({ jobId: unknown.id, userId: 'user-1', event: 'start' });
  const queued = seedStore.createJob({
    conversationId: conversation.id, userId: 'user-1', idempotencyKey: 'queued', inputText: 'resume queued'
  });
  seedDb.close();

  const prompts = [];
  const workbench = createProductionWorkbench({
    projectDir: root,
    env: {
      HOME: root,
      WORKBENCH_ROOT: root,
      DATABASE_PATH: databasePath,
      WEB_DIST_DIR: path.join(root, 'web'),
      OPENCODE_CMD: '/unused/opencode',
      OPENCODE_CWD: root,
      COOKIE_SECURE: 'false'
    },
    logger: { log() {}, error() {} },
    workerFactory({ id: workerId }) {
      return {
        client: {
          createSession: async () => ({ id: `session-${workerId}` }),
          prompt: async ({ text }) => {
            prompts.push(text);
            return { parts: [{ type: 'text', text: 'recovered' }] };
          },
          abortSession: async () => ({})
        },
        async start() { return { status: 'healthy' }; },
        async stop() { return { status: 'stopped' }; },
        async health() { return { healthy: true }; },
        snapshot() { return { status: 'healthy', endpoint: `http://127.0.0.1/${workerId}`, version: '1.18.25' }; }
      };
    }
  });
  t.after(async () => {
    await workbench.stop().catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  });

  await workbench.start(0, '127.0.0.1');
  await workbench.gatewayService.waitForIdle();
  assert.deepEqual(prompts, ['resume queued']);
  await workbench.stop();

  const verifyDb = openDatabase({ filename: databasePath });
  t.after(() => verifyDb.close());
  assert.equal(verifyDb.prepare('SELECT status FROM gateway_jobs WHERE id = ?').get(unknown.id).status, 'interrupted');
  assert.equal(verifyDb.prepare('SELECT status FROM gateway_jobs WHERE id = ?').get(queued.id).status, 'completed');
});
