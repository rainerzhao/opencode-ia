'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMySqlDatabase } = require('../../src/db/mysql-database');
const { migrateMySqlDatabase } = require('../../src/db/mysql-migrate');
const { createMySqlGatewayStore } = require('../../src/gateway/mysql-gateway-store');
const { createFairQueue } = require('../../src/gateway/fair-queue');
const { createGatewayService } = require('../../src/gateway/gateway-service');

const testUrl = process.env.WORKBENCH_TEST_MYSQL_URL;

test('runs one durable Gateway Conversation end to end against MySQL', { skip: !testUrl }, async (t) => {
  const db = await createMySqlDatabase({ url: testUrl, poolSize: 2 });
  t.after(async () => db.close());
  await migrateMySqlDatabase(db);
  await db.query("DELETE FROM users WHERE id = 'gateway-mysql-runtime-user'");
  await db.query("DELETE FROM gateway_workers WHERE id = 'mysql-worker-1'");
  await db.query(`
    INSERT INTO users (id, username, display_name, password_hash, role, status, created_at, updated_at)
    VALUES ('gateway-mysql-runtime-user', 'gateway.mysql.runtime', 'Gateway MySQL Runtime', 'hash', 'member', 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
  `);
  let nextId = 0;
  const durableStore = createMySqlGatewayStore(db, { idFactory: () => `mysql-runtime-${++nextId}` });
  const store = {
    ...durableStore,
    async upsertWorker(input) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return durableStore.upsertWorker(input);
    }
  };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mysql-gateway-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prompts = [];
  let onStatus = null;
  const pool = {
    async start() { onStatus?.({ id: 'mysql-worker-1', instanceId: 'mysql-runtime-instance-1', status: 'healthy', endpoint: 'http://127.0.0.1:4320', processId: 4320, version: '1.18.25', capacity: 1 }); },
    async stop() {},
    snapshot() { return { workers: [{ id: 'mysql-worker-1', status: 'healthy', capacity: 1, running: 0 }] }; },
    subscribeStatuses(listener) { onStatus = listener; return () => { onStatus = null; }; },
    acquire() {
      return {
        token: `lease-${prompts.length + 1}`,
        workerId: 'mysql-worker-1',
        client: {
          async createSession() { return { id: 'mysql-opencode-session-1' }; },
          async prompt(input) { prompts.push(input); return { parts: [{ type: 'text', text: 'MySQL durable response' }] }; }
        }
      };
    },
    release() {}
  };
  const service = createGatewayService({
    store, pool, queue: createFairQueue({ maxQueuedPerUser: 2 }), workspaceRoot: root,
    limits: { globalRunning: 1, userRunning: 1, jobTimeoutMs: 1_000 }, idFactory: () => 'mysql-runtime-binding-1'
  });
  t.after(async () => service.stop());
  const conversation = await store.createConversation({ ownerUserId: 'gateway-mysql-runtime-user', title: 'MySQL durable runtime' });
  await service.start();
  const job = await service.submit({
    conversationId: conversation.id, userId: 'gateway-mysql-runtime-user', idempotencyKey: 'mysql-runtime-request-1', inputText: 'continue the durable proposal'
  });
  await service.waitForIdle();

  assert.equal((await store.getJob({ id: job.id })).status, 'completed');
  assert.equal((await store.getOpenCodeSession({ conversationId: conversation.id })).opencodeSessionId, 'mysql-opencode-session-1');
  assert.equal(prompts[0].sessionId, 'mysql-opencode-session-1');
  assert.deepEqual((await store.listEventsAfter({ conversationId: conversation.id, ownerUserId: 'gateway-mysql-runtime-user', afterSequence: 0 })).map((event) => event.type), [
    'message.created', 'job.queued', 'job.started', 'message.delta', 'job.completed'
  ]);
  await db.query("DELETE FROM users WHERE id = 'gateway-mysql-runtime-user'");
  await db.query("DELETE FROM gateway_workers WHERE id = 'mysql-worker-1'");
});
