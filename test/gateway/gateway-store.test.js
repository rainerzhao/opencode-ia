'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../../src/db/open-database');
const { migrateDatabase } = require('../../src/db/migrate');
const { createGatewayStore } = require('../../src/gateway/gateway-store');
const { GATEWAY_EVENT_TYPES } = require('../../packages/shared/gateway-events');

function createFixture(t) {
  const db = openDatabase({ filename: ':memory:' });
  t.after(() => db.close());
  migrateDatabase(db);
  const insertUser = db.prepare(`
    INSERT INTO users (
      id, username, display_name, password_hash, role, status, created_at, updated_at
    ) VALUES (?, ?, ?, 'not-a-real-password-hash', 'member', 'active', ?, ?)
  `);
  for (const id of ['user-a', 'user-b']) {
    insertUser.run(id, id, id, '2026-09-04T01:00:00.000Z', '2026-09-04T01:00:00.000Z');
  }
  let nextId = 0;
  let nextSecond = 0;
  const store = createGatewayStore(db, {
    idFactory: () => `generated-${++nextId}`,
    clock: () => `2026-09-04T01:00:${String(nextSecond++).padStart(2, '0')}.000Z`
  });
  return { db, store };
}

test('creates private conversations and lists only the owner records', (t) => {
  const { store } = createFixture(t);
  const first = store.createConversation({
    ownerUserId: 'user-a',
    title: ' GPU 方案讨论 ',
    defaultModel: 'deepseek/deepseek-chat'
  });
  const second = store.createConversation({ ownerUserId: 'user-b', title: 'Private B' });

  assert.equal(first.title, 'GPU 方案讨论');
  assert.equal(first.ownerUserId, 'user-a');
  assert.equal(first.status, 'active');
  assert.equal(first.defaultModel, 'deepseek/deepseek-chat');
  assert.deepEqual(store.listConversations({ ownerUserId: 'user-a' }), [first]);
  assert.equal(store.getOwnedConversation({ id: first.id, ownerUserId: 'user-b' }), null);
  assert.equal(store.getOwnedConversation({ id: second.id, ownerUserId: 'user-a' }), null);
  assert.throws(
    () => store.createConversation({ ownerUserId: 'user-a', title: '   ' }),
    (error) => error.code === 'INVALID_CONVERSATION_TITLE'
  );
  assert.throws(
    () => store.createConversation({ ownerUserId: 'user-a', title: 'line one\nline two' }),
    (error) => error.code === 'INVALID_CONVERSATION_TITLE'
  );
});

test('deduplicates identical submissions and rejects idempotency-key reuse with different input', (t) => {
  const { store } = createFixture(t);
  const conversation = store.createConversation({ ownerUserId: 'user-a', title: 'Conversation A' });
  const created = store.createJob({
    conversationId: conversation.id,
    userId: 'user-a',
    idempotencyKey: 'request-1',
    inputText: '第一条问题'
  });
  const duplicate = store.createJob({
    conversationId: conversation.id,
    userId: 'user-a',
    idempotencyKey: 'request-1',
    inputText: '第一条问题'
  });

  assert.equal(created.status, 'queued');
  assert.equal(duplicate.id, created.id);
  assert.equal(duplicate.deduplicated, true);
  assert.equal(store.listEventsAfter({
    conversationId: conversation.id,
    ownerUserId: 'user-a',
    afterSequence: 0
  }).length, 1);
  assert.throws(
    () => store.createJob({
      conversationId: conversation.id,
      userId: 'user-a',
      idempotencyKey: 'request-1',
      inputText: '被错误复用的新问题'
    }),
    (error) => error.code === 'IDEMPOTENCY_CONFLICT'
  );
  assert.throws(
    () => store.createJob({
      conversationId: conversation.id,
      userId: 'user-b',
      idempotencyKey: 'request-b',
      inputText: '越权问题'
    }),
    (error) => error.code === 'CONVERSATION_NOT_FOUND'
  );
});

test('transitions a job and persists an ordered replayable event stream atomically', (t) => {
  const { store } = createFixture(t);
  const conversation = store.createConversation({ ownerUserId: 'user-a', title: 'Conversation A' });
  const job = store.createJob({
    conversationId: conversation.id,
    userId: 'user-a',
    idempotencyKey: 'request-1',
    inputText: 'hello'
  });

  const running = store.transitionJob({ jobId: job.id, userId: 'user-a', event: 'start' });
  store.appendEvent({
    conversationId: conversation.id,
    jobId: job.id,
    type: 'message.delta',
    payload: { text: '答' }
  });
  const completed = store.transitionJob({ jobId: job.id, userId: 'user-a', event: 'complete' });

  assert.equal(running.status, 'running');
  assert.match(running.startedAt, /^2026-09-04T/);
  assert.equal(completed.status, 'completed');
  assert.match(completed.finishedAt, /^2026-09-04T/);
  const events = store.listEventsAfter({
    conversationId: conversation.id,
    ownerUserId: 'user-a',
    afterSequence: 1
  });
  assert.deepEqual(events.map((event) => event.type), [
    'job.started',
    'message.delta',
    'job.completed'
  ]);
  assert.deepEqual(events.map((event) => event.sequence), [2, 3, 4]);
  assert.deepEqual(events[1].data, { text: '答' });
  assert.equal(store.listEventsAfter({
    conversationId: conversation.id,
    ownerUserId: 'user-b',
    afterSequence: 0
  }), null);
  assert.throws(
    () => store.appendEvent({
      conversationId: conversation.id,
      jobId: job.id,
      type: 'not.public',
      payload: {}
    }),
    (error) => error.code === 'INVALID_GATEWAY_EVENT'
  );
});

test('persists worker metadata and one sticky OpenCode session per conversation', (t) => {
  const { store } = createFixture(t);
  const conversation = store.createConversation({ ownerUserId: 'user-a', title: 'Conversation A' });
  const worker = store.upsertWorker({
    id: 'worker-1',
    instanceId: 'instance-1',
    status: 'healthy',
    endpoint: 'http://127.0.0.1:4319',
    processId: 1234,
    version: '1.18.25',
    capacity: 1
  });
  const binding = store.bindOpenCodeSession({
    id: 'binding-1',
    conversationId: conversation.id,
    opencodeSessionId: 'ses_one',
    workerId: worker.id,
    workspacePath: '/workspaces/user-a/conversation-a'
  });
  const rebound = store.bindOpenCodeSession({
    id: 'ignored-new-id',
    conversationId: conversation.id,
    opencodeSessionId: 'ses_two',
    workerId: worker.id,
    workspacePath: '/workspaces/user-a/conversation-a'
  });

  assert.equal(worker.endpoint, 'http://127.0.0.1:4319');
  assert.equal(binding.recoveryStatus, 'active');
  assert.equal(rebound.id, binding.id);
  assert.equal(rebound.opencodeSessionId, 'ses_two');
});

test('marks only unknown running work interrupted during startup recovery', (t) => {
  const { db, store } = createFixture(t);
  const conversation = store.createConversation({ ownerUserId: 'user-a', title: 'Conversation A' });
  store.upsertWorker({
    id: 'worker-1',
    instanceId: 'instance-1',
    status: 'healthy',
    capacity: 1
  });
  store.bindOpenCodeSession({
    id: 'binding-1',
    conversationId: conversation.id,
    opencodeSessionId: 'ses_one',
    workerId: 'worker-1',
    workspacePath: '/workspaces/user-a/conversation-a'
  });
  const runningJob = store.createJob({
    conversationId: conversation.id,
    userId: 'user-a',
    idempotencyKey: 'running-request',
    inputText: 'running'
  });
  store.transitionJob({ jobId: runningJob.id, userId: 'user-a', event: 'start' });
  const queuedJob = store.createJob({
    conversationId: conversation.id,
    userId: 'user-a',
    idempotencyKey: 'queued-request',
    inputText: 'queued'
  });

  const report = store.recoverOnStartup();

  assert.deepEqual(report, { interruptedJobs: 1, recoveringSessions: 1, stoppedWorkers: 1 });
  assert.equal(store.getJob({ id: runningJob.id }).status, 'interrupted');
  assert.equal(store.getJob({ id: queuedJob.id }).status, 'queued');
  assert.equal(db.prepare('SELECT status FROM gateway_workers WHERE id = ?').get('worker-1').status, 'stopped');
  assert.equal(
    db.prepare('SELECT recovery_status FROM opencode_sessions WHERE id = ?').get('binding-1').recovery_status,
    'recovering'
  );
  const events = store.listEventsAfter({
    conversationId: conversation.id,
    ownerUserId: 'user-a',
    afterSequence: 0
  });
  assert.equal(events.at(-1).type, GATEWAY_EVENT_TYPES.JOB_INTERRUPTED);
});
