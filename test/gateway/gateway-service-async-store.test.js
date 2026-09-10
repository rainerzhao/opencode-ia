'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createFairQueue } = require('../../src/gateway/fair-queue');
const { createGatewayService } = require('../../src/gateway/gateway-service');

test('submits a job through an asynchronous durable Gateway store', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-service-async-store-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const submitted = [];
  const store = {
    async recoverOnStartup() { return { interruptedJobs: 0, recoveringSessions: 0, stoppedWorkers: 0 }; },
    async listQueuedJobs() { return []; },
    async listRecoveringSessions() { return []; },
    async getOpenCodeSession() { return null; },
    async getJobByIdempotency() { return null; },
    async createJob(input) {
      submitted.push(input);
      return { id: 'async-job-1', conversationId: input.conversationId, userId: input.userId, status: 'queued' };
    }
  };
  const pool = {
    async start() {}, async stop() {}, snapshot() { return { workers: [] }; },
    acquire() { return null; }
  };
  const service = createGatewayService({
    store, pool, queue: createFairQueue({ maxQueuedPerUser: 2 }), workspaceRoot: root,
    limits: { globalRunning: 1, userRunning: 1, jobTimeoutMs: 1000 }
  });
  await service.start();
  const job = await service.submit({
    conversationId: 'conversation-1', userId: 'user-1', idempotencyKey: 'request-1', inputText: 'async durable prompt'
  });
  assert.equal(job.id, 'async-job-1');
  assert.equal(submitted.length, 1);
  assert.equal(service.snapshot().queue.totalQueued, 1);
  await service.stop();
});

test('runs an asynchronous durable Gateway job through one persistent OpenCode session', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-service-async-execution-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const jobs = new Map();
  const events = [];
  let binding = null;
  const store = {
    async recoverOnStartup() { return { interruptedJobs: 0, recoveringSessions: 0, stoppedWorkers: 0 }; },
    async listQueuedJobs() { return []; },
    async listRecoveringSessions() { return []; },
    async getJobByIdempotency() { return null; },
    async createJob(input) {
      const job = { id: 'async-execution-job', conversationId: input.conversationId, userId: input.userId, inputText: input.inputText, status: 'queued' };
      jobs.set(job.id, job);
      return job;
    },
    async getJob({ id }) { return jobs.get(id) || null; },
    async transitionJob({ jobId, event, workerId }) {
      const job = jobs.get(jobId);
      job.status = event === 'start' ? 'running' : event === 'complete' ? 'completed' : 'failed';
      if (workerId !== undefined) job.workerId = workerId;
      return job;
    },
    async getOpenCodeSession() { return binding; },
    async getOwnedConversation() { return { id: 'conversation-1', title: 'Async durable conversation', defaultModel: 'internal/model-a' }; },
    async bindOpenCodeSession(input) {
      binding = { id: input.id, conversationId: input.conversationId, opencodeSessionId: input.opencodeSessionId, workerId: input.workerId, workspacePath: input.workspacePath, recoveryStatus: 'active' };
      return binding;
    },
    async attachJobBinding({ jobId, bindingId }) {
      jobs.get(jobId).opencodeSessionBindingId = bindingId;
      return jobs.get(jobId);
    },
    async appendEvent(input) { events.push(input); return { sequence: events.length, ...input }; }
  };
  const prompts = [];
  const pool = {
    async start() {}, async stop() {}, snapshot() { return { workers: [{ id: 'worker-1', status: 'healthy', capacity: 1, running: 0 }] }; },
    acquire() {
      return {
        token: 'lease-1', workerId: 'worker-1',
        client: {
          async createSession({ title, model }) { assert.equal(title, 'Async durable conversation'); assert.equal(model, 'internal/model-a'); return { id: 'opencode-session-1' }; },
          async prompt(input) { prompts.push(input); return { parts: [{ type: 'text', text: 'persistent response' }] }; }
        }
      };
    },
    release() {}
  };
  const service = createGatewayService({
    store, pool, queue: createFairQueue({ maxQueuedPerUser: 2 }), workspaceRoot: root,
    limits: { globalRunning: 1, userRunning: 1, jobTimeoutMs: 1000 }, idFactory: () => 'binding-1'
  });
  await service.start();
  await service.submit({ conversationId: 'conversation-1', userId: 'user-1', idempotencyKey: 'request-1', inputText: 'continue the proposal' });
  await service.waitForIdle();

  assert.equal(jobs.get('async-execution-job').status, 'completed');
  assert.equal(jobs.get('async-execution-job').opencodeSessionBindingId, 'binding-1');
  assert.equal(prompts[0].sessionId, 'opencode-session-1');
  assert.deepEqual(events.map((event) => event.payload), [{ text: 'persistent response' }]);
  await service.stop();
});

test('replays a private asynchronous durable event stream before subscribing', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-service-async-subscribe-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = {
    async recoverOnStartup() { return { interruptedJobs: 0, recoveringSessions: 0, stoppedWorkers: 0 }; },
    async listQueuedJobs() { return []; },
    async listRecoveringSessions() { return []; },
    async getOwnedConversation() { return { id: 'conversation-1', title: 'Private async conversation', defaultModel: null }; },
    async getLatestEventSequence() { return 1; },
    async listEventsAfter() {
      return [{ sequence: 1, conversationId: 'conversation-1', jobId: 'job-1', type: 'message.delta', data: { text: 'replayed answer' }, occurredAt: '2026-09-10T00:00:00.000Z' }];
    }
  };
  const pool = { async start() {}, async stop() {}, snapshot() { return { workers: [] }; }, acquire() { return null; } };
  const service = createGatewayService({
    store, pool, queue: createFairQueue({ maxQueuedPerUser: 2 }), workspaceRoot: root,
    limits: { globalRunning: 1, userRunning: 1, jobTimeoutMs: 1000 }
  });
  await service.start();
  const received = [];
  const unsubscribe = await service.subscribe({
    conversationId: 'conversation-1', userId: 'user-1', afterSequence: 0, onEvent: (event) => received.push(event)
  });
  assert.deepEqual(received.map((event) => event.type), ['conversation.snapshot', 'message.delta']);
  unsubscribe();
  await service.stop();
});
