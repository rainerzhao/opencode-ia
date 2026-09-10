'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../../src/db/open-database');
const { migrateDatabase } = require('../../src/db/migrate');
const { createGatewayStore } = require('../../src/gateway/gateway-store');
const { createFairQueue } = require('../../src/gateway/fair-queue');
const { recoverGateway } = require('../../src/gateway/recovery');

function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-recovery-'));
  const workspaceRoot = path.join(root, 'workspaces');
  fs.mkdirSync(workspaceRoot, { recursive: true });
  const db = openDatabase({ filename: path.join(root, 'workbench.db') });
  migrateDatabase(db);
  t.after(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const now = '2026-09-07T02:00:00.000Z';
  db.prepare(`
    INSERT INTO users (
      id, username, display_name, password_hash, role, status, created_at, updated_at
    ) VALUES (?, ?, ?, 'not-a-password', 'member', 'active', ?, ?)
  `).run('user-1', 'user-1', 'User 1', now, now);
  let nextId = 0;
  let second = 0;
  const store = createGatewayStore(db, {
    idFactory: () => `generated-${++nextId}`,
    clock: () => `2026-09-07T02:00:${String(second++).padStart(2, '0')}.000Z`
  });
  return { root, workspaceRoot, db, store };
}

test('recovers queued work in order, interrupts unknown running work, and validates session bindings', async (t) => {
  const fixture = createFixture(t);
  const available = fixture.store.createConversation({ ownerUserId: 'user-1', title: 'Available session' });
  const unavailable = fixture.store.createConversation({ ownerUserId: 'user-1', title: 'Unavailable session' });
  fixture.store.upsertWorker({
    id: 'worker-1', instanceId: 'old-worker-1', status: 'healthy', capacity: 1
  });
  for (const [conversation, sessionId] of [[available, 'session-ok'], [unavailable, 'session-missing']]) {
    const directory = path.join(fixture.workspaceRoot, conversation.id);
    fs.mkdirSync(directory, { recursive: true });
    fixture.store.bindOpenCodeSession({
      id: `binding-${sessionId}`,
      conversationId: conversation.id,
      opencodeSessionId: sessionId,
      workerId: 'worker-1',
      workspacePath: directory
    });
  }
  const running = fixture.store.createJob({
    conversationId: available.id, userId: 'user-1', idempotencyKey: 'running', inputText: 'do not replay'
  });
  fixture.store.transitionJob({ jobId: running.id, userId: 'user-1', event: 'start' });
  const queuedA = fixture.store.createJob({
    conversationId: available.id, userId: 'user-1', idempotencyKey: 'queued-a', inputText: 'queued a'
  });
  const queuedB = fixture.store.createJob({
    conversationId: unavailable.id, userId: 'user-1', idempotencyKey: 'queued-b', inputText: 'queued b'
  });
  const completed = fixture.store.createJob({
    conversationId: available.id, userId: 'user-1', idempotencyKey: 'completed', inputText: 'already done'
  });
  fixture.store.transitionJob({ jobId: completed.id, userId: 'user-1', event: 'start' });
  fixture.store.transitionJob({ jobId: completed.id, userId: 'user-1', event: 'complete' });

  const calls = { start: 0, prompt: 0, getSession: [], released: [] };
  const pool = {
    async start() { calls.start += 1; return { status: 'running' }; },
    acquire({ conversationId }) {
      return {
        token: `lease-${conversationId}`,
        workerId: 'worker-1',
        client: {
          async getSession({ sessionId }) {
            calls.getSession.push(sessionId);
            if (sessionId === 'session-missing') throw Object.assign(new Error('missing'), { code: 'OPENCODE_API_ERROR' });
            return { id: sessionId };
          },
          async prompt() { calls.prompt += 1; }
        }
      };
    },
    release(lease) { calls.released.push(lease.token); }
  };
  const queue = createFairQueue({ maxQueuedPerUser: 3 });

  const report = await recoverGateway({
    store: fixture.store,
    pool,
    queue,
    workspaceRoot: fixture.workspaceRoot
  });

  assert.deepEqual(report, {
    interruptedJobs: 1,
    recoveringSessions: 2,
    stoppedWorkers: 1,
    requeuedJobs: 1,
    interruptedQueuedJobs: 1,
    restoredSessions: 1,
    unavailableSessions: 1
  });
  assert.equal(calls.start, 1);
  assert.equal(calls.prompt, 0);
  assert.deepEqual(calls.getSession.sort(), ['session-missing', 'session-ok']);
  assert.equal(fixture.store.getJob({ id: running.id }).status, 'interrupted');
  assert.equal(fixture.store.getJob({ id: completed.id }).status, 'completed');
  assert.equal(fixture.store.getJob({ id: queuedB.id }).status, 'interrupted');
  assert.equal(fixture.store.getJob({ id: queuedB.id }).errorCode, 'OPENCODE_SESSION_UNAVAILABLE');
  assert.equal(fixture.store.getOpenCodeSession({ conversationId: available.id }).recoveryStatus, 'active');
  assert.equal(fixture.store.getOpenCodeSession({ conversationId: unavailable.id }).recoveryStatus, 'unavailable');
  assert.deepEqual(
    [queue.nextEligible(), queue.nextEligible()].map((job) => job?.id || null),
    [queuedA.id, null]
  );
  assert.deepEqual(
    fixture.store.listEventsAfter({
      conversationId: unavailable.id,
      ownerUserId: 'user-1',
      afterSequence: 0
    }).slice(-2).map((event) => event.type),
    ['conversation.recovery_boundary', 'job.interrupted']
  );
});

test('keeps new conversations queued when no previous OpenCode session exists', async (t) => {
  const { store, workspaceRoot } = createFixture(t);
  const conversation = store.createConversation({ ownerUserId: 'user-1', title: 'First prompt' });
  const job = store.createJob({ conversationId: conversation.id, userId: 'user-1', idempotencyKey: 'first', inputText: 'start a new session' });
  const queue = createFairQueue({ maxQueuedPerUser: 3 });
  const report = await recoverGateway({ store, queue, workspaceRoot, pool: { async start() {} } });
  assert.equal(report.requeuedJobs, 1);
  assert.equal(report.interruptedQueuedJobs, 0);
  assert.equal(queue.nextEligible().id, job.id);
  assert.equal(store.getJob({ id: job.id }).status, 'queued');
});

test('waits for an asynchronous durable store during recovery', async () => {
  const queue = createFairQueue({ maxQueuedPerUser: 1 });
  const calls = [];
  const store = {
    async recoverOnStartup() { calls.push('recover'); return { interruptedJobs: 0, recoveringSessions: 0, stoppedWorkers: 0 }; },
    async listQueuedJobs() { calls.push('queued'); return []; },
    async listRecoveringSessions() { calls.push('sessions'); return []; }
  };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-async-recovery-'));
  try {
    const report = await recoverGateway({
      store, queue, workspaceRoot: root,
      pool: { async start() { calls.push('start'); } }
    });
    assert.deepEqual(report, {
      interruptedJobs: 0, recoveringSessions: 0, stoppedWorkers: 0,
      requeuedJobs: 0, interruptedQueuedJobs: 0, restoredSessions: 0, unavailableSessions: 0
    });
    assert.deepEqual(calls, ['recover', 'queued', 'start', 'sessions']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fails startup instead of silently dropping persisted jobs above the configured queue limit', async (t) => {
  const fixture = createFixture(t);
  const conversations = [];
  for (let index = 0; index < 2; index += 1) {
    const conversation = fixture.store.createConversation({ ownerUserId: 'user-1', title: `Queued ${index}` });
    conversations.push(conversation);
    fixture.store.createJob({
      conversationId: conversation.id,
      userId: 'user-1',
      idempotencyKey: `queued-${index}`,
      inputText: `queued ${index}`
    });
  }
  const queue = createFairQueue({ maxQueuedPerUser: 1 });

  await assert.rejects(
    recoverGateway({
      store: fixture.store,
      pool: { async start() { throw new Error('must not start'); } },
      queue,
      workspaceRoot: fixture.workspaceRoot
    }),
    (error) => error.code === 'GATEWAY_RECOVERY_QUEUE_LIMIT'
  );
  assert.equal(queue.snapshot().totalQueued, 0);
  assert.equal(fixture.store.getJob({ id: fixture.store.listQueuedJobs()[1].id }).status, 'queued');
});

test('a failed worker startup leaves the queue empty so recovery can be retried', async (t) => {
  const { store, workspaceRoot } = createFixture(t);
  const conversation = store.createConversation({ ownerUserId: 'user-1', title: 'Retry startup' });
  const job = store.createJob({ conversationId: conversation.id, userId: 'user-1', idempotencyKey: 'retry', inputText: 'pending' });
  const queue = createFairQueue({ maxQueuedPerUser: 3 });
  await assert.rejects(recoverGateway({ store, queue, workspaceRoot, pool: { async start() { throw new Error('worker unavailable'); } } }));
  assert.equal(queue.snapshot().totalQueued, 0);
  await recoverGateway({ store, queue, workspaceRoot, pool: { async start() {} } });
  assert.equal(queue.nextEligible().id, job.id);
  assert.equal(queue.nextEligible(), null);
});
