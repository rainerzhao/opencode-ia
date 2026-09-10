'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMySqlDatabase } = require('../../src/db/mysql-database');
const { migrateMySqlDatabase } = require('../../src/db/mysql-migrate');
const { createMySqlGatewayStore } = require('../../src/gateway/mysql-gateway-store');

const testUrl = process.env.WORKBENCH_TEST_MYSQL_URL;

test('persists private Gateway conversations, jobs, ordered events, bindings, and restart recovery on MySQL', { skip: !testUrl }, async (t) => {
  const db = await createMySqlDatabase({ url: testUrl, poolSize: 2 });
  t.after(async () => db.close());
  await migrateMySqlDatabase(db);
  const now = new Date('2026-09-10T12:00:00.000Z');
  const timestamp = () => new Date(now.getTime() + (now.setUTCSeconds(now.getUTCSeconds() + 1) - now.getTime())).toISOString();
  await db.query(`
    INSERT INTO users (id, username, display_name, password_hash, role, status, created_at, updated_at)
    VALUES
      ('gateway-mysql-user-a', 'gateway.mysql.a', 'Gateway MySQL A', 'hash', 'member', 'active', '2026-09-10 12:00:00.000', '2026-09-10 12:00:00.000'),
      ('gateway-mysql-user-b', 'gateway.mysql.b', 'Gateway MySQL B', 'hash', 'member', 'active', '2026-09-10 12:00:00.000', '2026-09-10 12:00:00.000')
  `);
  let nextId = 0;
  const store = createMySqlGatewayStore(db, {
    idFactory: () => `mysql-gateway-${++nextId}`,
    clock: timestamp
  });

  const conversation = await store.createConversation({
    ownerUserId: 'gateway-mysql-user-a', title: 'MySQL persistent conversation', defaultModel: 'internal/model-a'
  });
  assert.equal((await store.getOwnedConversation({ id: conversation.id, ownerUserId: 'gateway-mysql-user-b' })), null);
  const job = await store.createJob({
    conversationId: conversation.id, userId: 'gateway-mysql-user-a', idempotencyKey: 'mysql-request-1', inputText: '持续方案讨论'
  });
  assert.equal((await store.createJob({
    conversationId: conversation.id, userId: 'gateway-mysql-user-a', idempotencyKey: 'mysql-request-1', inputText: '持续方案讨论'
  })).deduplicated, true);
  await assert.rejects(
    () => store.createJob({
      conversationId: conversation.id, userId: 'gateway-mysql-user-a', idempotencyKey: 'mysql-request-1', inputText: 'different input'
    }),
    (error) => error?.code === 'IDEMPOTENCY_CONFLICT'
  );

  await store.transitionJob({ jobId: job.id, userId: 'gateway-mysql-user-a', event: 'start' });
  await store.appendEvent({ conversationId: conversation.id, jobId: job.id, type: 'message.delta', payload: { text: '第一段回答' } });
  await store.transitionJob({ jobId: job.id, userId: 'gateway-mysql-user-a', event: 'complete' });
  const events = await store.listEventsAfter({ conversationId: conversation.id, ownerUserId: 'gateway-mysql-user-a', afterSequence: 0 });
  assert.deepEqual(events.map((event) => event.type), ['message.created', 'job.queued', 'job.started', 'message.delta', 'job.completed']);
  assert.deepEqual(events.map((event) => event.sequence), [1, 2, 3, 4, 5]);

  await store.upsertWorker({ id: 'gateway-mysql-worker-1', instanceId: 'mysql-instance-1', status: 'healthy', capacity: 2 });
  await assert.rejects(
    () => store.upsertWorker({ id: 'gateway-mysql-worker-invalid', instanceId: 'mysql-instance-invalid', status: 'healthy', processId: 0 }),
    (error) => error?.code === 'INVALID_WORKER_PROCESS'
  );
  const binding = await store.bindOpenCodeSession({
    id: 'gateway-mysql-binding-1', conversationId: conversation.id, opencodeSessionId: 'ses-mysql-1',
    workerId: 'gateway-mysql-worker-1', workspacePath: '/tmp/gateway-mysql-user-a/conversation-1'
  });
  assert.equal((await store.getOpenCodeSession({ conversationId: conversation.id })).id, binding.id);

  const recovering = await store.createJob({
    conversationId: conversation.id, userId: 'gateway-mysql-user-a', idempotencyKey: 'mysql-request-2', inputText: 'restart boundary'
  });
  await store.transitionJob({ jobId: recovering.id, userId: 'gateway-mysql-user-a', event: 'start' });
  assert.deepEqual(await store.recoverOnStartup(), { interruptedJobs: 1, recoveringSessions: 1, stoppedWorkers: 1 });
  assert.equal((await store.getJob({ id: recovering.id })).status, 'interrupted');
  assert.equal((await store.getOpenCodeSession({ conversationId: conversation.id })).recoveryStatus, 'recovering');
});
