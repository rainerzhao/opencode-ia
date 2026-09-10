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
  await db.query(`
    DELETE FROM users
    WHERE id IN ('gateway-mysql-user-a', 'gateway-mysql-user-b')
  `);
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
  assert.equal((await store.getJobByIdempotency({
    userId: 'gateway-mysql-user-a', idempotencyKey: 'mysql-request-1'
  })).id, job.id);
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
  assert.equal(events.every((event, index) => event.sequence === events[0].sequence + index), true);

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

  const boundJob = await store.createJob({
    conversationId: conversation.id, userId: 'gateway-mysql-user-a', idempotencyKey: 'mysql-request-binding', inputText: 'bind this running job'
  });
  await store.transitionJob({ jobId: boundJob.id, userId: 'gateway-mysql-user-a', event: 'start', workerId: 'gateway-mysql-worker-1' });
  const attached = await store.attachJobBinding({
    jobId: boundJob.id, workerId: 'gateway-mysql-worker-1', bindingId: binding.id
  });
  assert.equal(attached.opencodeSessionBindingId, binding.id);
  await store.transitionJob({ jobId: boundJob.id, userId: 'gateway-mysql-user-a', event: 'complete' });

  const queued = await store.createJob({
    conversationId: conversation.id, userId: 'gateway-mysql-user-a', idempotencyKey: 'mysql-request-queued', inputText: 'queue me for restart'
  });
  assert.deepEqual((await store.listQueuedJobs()).map((item) => item.id), [queued.id]);
  assert.equal((await store.listJobMetadata()).some((item) => item.id === queued.id && item.status === 'queued'), true);
  assert.equal(await store.getLatestEventSequence({ conversationId: conversation.id, ownerUserId: 'gateway-mysql-user-a' }) > 0, true);
  assert.equal(await store.markWorkerSessionsRecovering({ workerId: 'gateway-mysql-worker-1' }), 1);
  assert.equal((await store.listRecoveringSessions({ workerId: 'gateway-mysql-worker-1' }))[0].ownerUserId, 'gateway-mysql-user-a');
  assert.equal((await store.setSessionRecoveryStatus({
    conversationId: conversation.id, recoveryStatus: 'active', workerId: 'gateway-mysql-worker-1'
  })).recoveryStatus, 'active');

  assert.equal((await store.updateConversation({
    id: conversation.id, ownerUserId: 'gateway-mysql-user-a', title: 'Renamed MySQL conversation'
  })).title, 'Renamed MySQL conversation');
  assert.equal((await store.listConversations({ ownerUserId: 'gateway-mysql-user-a' }))[0].id, conversation.id);
  assert.equal((await store.listConversationMetadata()).some((item) => item.id === conversation.id), true);

  const recovering = await store.createJob({
    conversationId: conversation.id, userId: 'gateway-mysql-user-a', idempotencyKey: 'mysql-request-2', inputText: 'restart boundary'
  });
  await store.transitionJob({ jobId: recovering.id, userId: 'gateway-mysql-user-a', event: 'start' });
  assert.deepEqual(await store.recoverOnStartup(), { interruptedJobs: 1, recoveringSessions: 1, stoppedWorkers: 1 });
  assert.equal((await store.getJob({ id: recovering.id })).status, 'interrupted');
  assert.equal((await store.getOpenCodeSession({ conversationId: conversation.id })).recoveryStatus, 'recovering');
  assert.equal((await store.archiveConversation({ id: conversation.id, ownerUserId: 'gateway-mysql-user-a' })).status, 'archived');
});
