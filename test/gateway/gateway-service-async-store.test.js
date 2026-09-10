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
