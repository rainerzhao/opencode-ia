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
const { createWorkerPool } = require('../../src/gateway/worker-pool');
const { createGatewayService } = require('../../src/gateway/gateway-service');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

async function eventually(check, message = 'condition was not reached') {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail(message);
}

function createFixture(t, {
  automatic = false,
  jobTimeoutMs = 1000,
  failSessionForWorker = null
} = {}) {
  const db = openDatabase({ filename: ':memory:' });
  migrateDatabase(db);
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-workspaces-'));
  t.after(async () => {
    await service.stop();
    db.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });
  const insertUser = db.prepare(`
    INSERT INTO users (
      id, username, display_name, password_hash, role, status, created_at, updated_at
    ) VALUES (?, ?, ?, 'not-a-password', 'member', 'active', ?, ?)
  `);
  for (let index = 1; index <= 20; index += 1) {
    const id = `user-${index}`;
    insertUser.run(id, id, id, '2026-09-04T01:00:00.000Z', '2026-09-04T01:00:00.000Z');
  }
  let nextId = 0;
  let nextTime = 0;
  const store = createGatewayStore(db, {
    idFactory: () => `generated-${++nextId}`,
    clock: () => `2026-09-04T01:${String(Math.floor(nextTime / 60)).padStart(2, '0')}:${String(nextTime++ % 60).padStart(2, '0')}.000Z`
  });

  const records = [];
  const pending = new Map();
  let running = 0;
  let maxRunning = 0;
  const runningByUser = new Map();
  let maxPerUser = 0;
  const starts = [];
  const pool = createWorkerPool({
    workerCount: 2,
    heartbeatMs: 60_000,
    workerFactory: ({ id, index, onExit }) => {
      const record = { id, index, status: 'stopped', onExit, sessions: 0 };
      records.push(record);
      const client = {
        async createSession({ directory }) {
          if (failSessionForWorker === id) {
            const error = new Error('session failed');
            error.code = 'OPENCODE_API_ERROR';
            throw error;
          }
          record.sessions += 1;
          return { id: `${id}-session-${record.sessions}`, directory };
        },
        async prompt({ text, signal }) {
          const [userId] = text.split(':');
          running += 1;
          maxRunning = Math.max(maxRunning, running);
          const userRunning = (runningByUser.get(userId) || 0) + 1;
          runningByUser.set(userId, userRunning);
          maxPerUser = Math.max(maxPerUser, userRunning);
          starts.push(text);
          const gate = deferred();
          pending.set(text, gate);
          if (automatic) setImmediate(() => gate.resolve(`answer:${text}`));
          const onAbort = () => {
            const error = new Error('aborted');
            error.code = 'OPENCODE_ABORTED';
            gate.reject(error);
          };
          signal?.addEventListener('abort', onAbort, { once: true });
          try {
            const answer = await gate.promise;
            return { parts: [{ type: 'text', text: answer }] };
          } finally {
            signal?.removeEventListener('abort', onAbort);
            pending.delete(text);
            running -= 1;
            runningByUser.set(userId, runningByUser.get(userId) - 1);
          }
        },
        async abortSession() { return true; }
      };
      record.worker = {
        client,
        async start() { record.status = 'healthy'; return record.worker.snapshot(); },
        async stop() { record.status = 'stopped'; return record.worker.snapshot(); },
        async health() { return { healthy: true, version: '1.18.25' }; },
        snapshot() {
          return {
            status: record.status,
            endpoint: `http://127.0.0.1:${4319 + index}`,
            processId: record.status === 'healthy' ? 1000 + index : null,
            version: '1.18.25'
          };
        }
      };
      record.crash = () => {
        record.status = 'unhealthy';
        onExit({ expected: false, code: 71, signal: null });
      };
      return record.worker;
    }
  });
  const queue = createFairQueue({ maxQueuedPerUser: 3 });
  const service = createGatewayService({
    store,
    pool,
    queue,
    workspaceRoot,
    limits: { globalRunning: 2, userRunning: 1, jobTimeoutMs },
    idFactory: () => `binding-${++nextId}`
  });

  function conversation(userNumber, suffix = 'a') {
    return store.createConversation({
      ownerUserId: `user-${userNumber}`,
      title: `Conversation ${userNumber}-${suffix}`
    });
  }

  function submit(conversationRecord, userNumber, suffix) {
    const userId = `user-${userNumber}`;
    return service.submit({
      conversationId: conversationRecord.id,
      userId,
      idempotencyKey: `${userId}-${suffix}`,
      inputText: `${userId}:${suffix}`
    });
  }

  return {
    db,
    store,
    pool,
    service,
    records,
    pending,
    starts,
    conversation,
    submit,
    metrics: () => ({ maxRunning, maxPerUser })
  };
}

test('serializes one conversation, limits one user, and runs two users in parallel', async (t) => {
  const fixture = createFixture(t);
  await fixture.service.start();
  const a = fixture.conversation(1);
  const b = fixture.conversation(2);
  const first = fixture.submit(a, 1, 'first');
  const sameConversation = fixture.submit(a, 1, 'second');
  const otherUser = fixture.submit(b, 2, 'first');

  await eventually(() => fixture.pending.size === 2);
  assert.deepEqual(new Set(fixture.starts), new Set(['user-1:first', 'user-2:first']));
  assert.equal(fixture.store.getJob({ id: sameConversation.id }).status, 'queued');
  fixture.pending.get('user-1:first').resolve('answer-a-1');
  await eventually(() => fixture.pending.has('user-1:second'));
  fixture.pending.get('user-1:second').resolve('answer-a-2');
  fixture.pending.get('user-2:first').resolve('answer-b-1');
  await fixture.service.waitForIdle();

  assert.equal(fixture.store.getJob({ id: first.id }).status, 'completed');
  assert.equal(fixture.store.getJob({ id: sameConversation.id }).status, 'completed');
  assert.equal(fixture.store.getJob({ id: otherUser.id }).status, 'completed');
  assert.deepEqual(fixture.metrics(), { maxRunning: 2, maxPerUser: 1 });
});

test('deduplicates submit and emits queued, started, delta, completed in order', async (t) => {
  const fixture = createFixture(t, { automatic: true });
  await fixture.service.start();
  const conversation = fixture.conversation(1);
  const first = fixture.submit(conversation, 1, 'same');
  const duplicate = fixture.submit(conversation, 1, 'same');
  assert.equal(duplicate.id, first.id);
  assert.equal(duplicate.deduplicated, true);
  await fixture.service.waitForIdle();

  const events = fixture.store.listEventsAfter({
    conversationId: conversation.id,
    ownerUserId: 'user-1'
  });
  assert.deepEqual(events.map((event) => event.type), [
    'job.queued',
    'job.started',
    'message.delta',
    'job.completed'
  ]);
  assert.equal(events[2].data.text, 'answer:user-1:same');
  assert.equal(fixture.records.reduce((sum, record) => sum + record.sessions, 0), 1);
});

test('rejects queue overflow without leaving an orphaned idempotent job', async (t) => {
  const fixture = createFixture(t);
  await fixture.service.start();
  const conversations = Array.from({ length: 5 }, (_, index) => fixture.conversation(1, String(index)));
  fixture.submit(conversations[0], 1, 'running');
  await eventually(() => fixture.pending.has('user-1:running'));
  const queued = [1, 2, 3].map((index) => fixture.submit(conversations[index], 1, `queued-${index}`));

  assert.throws(
    () => fixture.submit(conversations[4], 1, 'overflow'),
    (error) => error.code === 'USER_QUEUE_LIMIT'
  );
  await fixture.service.cancel({ jobId: queued[0].id, userId: 'user-1' });
  const retried = fixture.submit(conversations[4], 1, 'overflow');
  assert.equal(retried.deduplicated, undefined);
});

test('marks a job failed when OpenCode session creation fails', async (t) => {
  const fixture = createFixture(t, { failSessionForWorker: 'worker-1' });
  await fixture.service.start();
  const conversation = fixture.conversation(1);
  const job = fixture.submit(conversation, 1, 'session-failure');
  await fixture.service.waitForIdle();

  assert.equal(fixture.store.getJob({ id: job.id }).status, 'failed');
  assert.equal(fixture.store.getJob({ id: job.id }).errorCode, 'OPENCODE_API_ERROR');
});

test('cancels queued and running jobs and marks a deadline as timed out', async (t) => {
  const fixture = createFixture(t, { jobTimeoutMs: 30 });
  await fixture.service.start();
  const firstConversation = fixture.conversation(1, 'a');
  const secondConversation = fixture.conversation(1, 'b');
  const running = fixture.submit(firstConversation, 1, 'running');
  const queued = fixture.submit(secondConversation, 1, 'queued');
  await eventually(() => fixture.pending.has('user-1:running'));

  assert.equal((await fixture.service.cancel({ jobId: queued.id, userId: 'user-1' })).status, 'cancelled');
  assert.equal((await fixture.service.cancel({ jobId: running.id, userId: 'user-1' })).status, 'cancelled');
  await fixture.service.waitForIdle();

  const timeoutConversation = fixture.conversation(2);
  const timedOut = fixture.submit(timeoutConversation, 2, 'timeout');
  await fixture.service.waitForIdle();
  assert.equal(fixture.store.getJob({ id: timedOut.id }).status, 'timed_out');
  assert.equal(fixture.store.getJob({ id: timedOut.id }).errorCode, 'GATEWAY_JOB_TIMEOUT');
});

test('interrupts only the job on a crashed worker while the other worker completes', async (t) => {
  const fixture = createFixture(t);
  await fixture.service.start();
  const a = fixture.conversation(1);
  const b = fixture.conversation(2);
  const first = fixture.submit(a, 1, 'first');
  const second = fixture.submit(b, 2, 'first');
  await eventually(() => fixture.pending.size === 2);
  const firstJob = fixture.store.getJob({ id: first.id });
  const crashed = fixture.records.find((record) => record.id === firstJob.workerId);

  crashed.crash();
  fixture.pending.get('user-2:first').resolve('answer-b');
  await fixture.service.waitForIdle();

  assert.equal(fixture.store.getJob({ id: first.id }).status, 'interrupted');
  assert.equal(fixture.store.getJob({ id: first.id }).errorCode, 'WORKER_EXITED');
  assert.equal(fixture.store.getJob({ id: second.id }).status, 'completed');
});

test('completes a deterministic 20-user simulation without starvation or limit breaches', async (t) => {
  const fixture = createFixture(t, { automatic: true });
  await fixture.service.start();
  const jobs = [];
  for (let user = 1; user <= 20; user += 1) {
    jobs.push(fixture.submit(fixture.conversation(user), user, 'load'));
  }
  await fixture.service.waitForIdle();

  assert.equal(jobs.every((job) => fixture.store.getJob({ id: job.id }).status === 'completed'), true);
  assert.equal(new Set(fixture.starts.map((text) => text.split(':')[0])).size, 20);
  assert.deepEqual(fixture.metrics(), { maxRunning: 2, maxPerUser: 1 });
});

test('persists stopped worker metadata during clean Gateway shutdown', async (t) => {
  const fixture = createFixture(t);
  await fixture.service.start();
  await fixture.service.stop();

  assert.deepEqual(
    fixture.db.prepare('SELECT status FROM gateway_workers ORDER BY id').all().map((row) => row.status),
    ['stopped', 'stopped']
  );
});
