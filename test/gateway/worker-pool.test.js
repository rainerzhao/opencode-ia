'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkerPool } = require('../../src/gateway/worker-pool');

function createWorkerFactory() {
  const records = [];
  const factory = ({ id, index, onExit }) => {
    const state = {
      id,
      index,
      status: 'stopped',
      starts: 0,
      stops: 0,
      healthFailures: 0,
      onExit
    };
    const worker = {
      client: { workerId: id },
      async start() {
        state.starts += 1;
        state.status = 'healthy';
        return worker.snapshot();
      },
      async stop() {
        state.stops += 1;
        state.status = 'stopped';
        return worker.snapshot();
      },
      async health() {
        if (state.healthFailures > 0) {
          state.healthFailures -= 1;
          const error = new Error('health failed');
          error.code = 'OPENCODE_UNAVAILABLE';
          throw error;
        }
        return { healthy: true, version: '1.18.25' };
      },
      snapshot() {
        return {
          status: state.status,
          endpoint: `http://127.0.0.1:${4319 + index}`,
          processId: state.status === 'healthy' ? 1000 + index : null,
          version: '1.18.25'
        };
      }
    };
    state.worker = worker;
    state.crash = () => {
      state.status = 'unhealthy';
      onExit({ expected: false, code: 71, signal: null });
    };
    records.push(state);
    return worker;
  };
  return { factory, records };
}

test('starts two workers and exposes exactly two parallel leases', async (t) => {
  const fixture = createWorkerFactory();
  const pool = createWorkerPool({ workerCount: 2, workerFactory: fixture.factory });
  t.after(() => pool.stop());
  await pool.start();

  const first = pool.acquire({ conversationId: 'conversation-a' });
  const second = pool.acquire({ conversationId: 'conversation-b' });
  assert.notEqual(first.workerId, second.workerId);
  assert.equal(pool.acquire({ conversationId: 'conversation-c' }), null);
  assert.deepEqual(pool.snapshot().workers.map((worker) => worker.running), [1, 1]);

  pool.release(first);
  assert.equal(pool.acquire({ conversationId: 'conversation-c' }).workerId, first.workerId);
});

test('reuses the sticky worker for a conversation after release', async (t) => {
  const fixture = createWorkerFactory();
  const pool = createWorkerPool({ workerCount: 2, workerFactory: fixture.factory });
  t.after(() => pool.stop());
  await pool.start();

  const first = pool.acquire({ conversationId: 'conversation-a' });
  pool.release(first);
  const second = pool.acquire({ conversationId: 'conversation-a' });

  assert.equal(second.workerId, first.workerId);
  assert.equal(second.client.workerId, first.workerId);
});

test('excludes an unhealthy worker and reports only its affected lease', async (t) => {
  const fixture = createWorkerFactory();
  const exits = [];
  const pool = createWorkerPool({
    workerCount: 2,
    workerFactory: fixture.factory,
    onWorkerExit: (event) => exits.push(event)
  });
  t.after(() => pool.stop());
  await pool.start();
  const affected = pool.acquire({ conversationId: 'conversation-a' });
  const unaffected = pool.acquire({ conversationId: 'conversation-b' });

  fixture.records.find((record) => record.id === affected.workerId).crash();

  assert.deepEqual(exits[0].leases.map((lease) => lease.conversationId), ['conversation-a']);
  assert.equal(pool.snapshot().workers.find((worker) => worker.id === affected.workerId).status, 'unhealthy');
  pool.release(unaffected);
  assert.equal(pool.acquire({ conversationId: 'conversation-c' }).workerId, unaffected.workerId);
});

test('heartbeat removes a failed worker then restarts it on a later pass', async (t) => {
  const fixture = createWorkerFactory();
  const pool = createWorkerPool({ workerCount: 2, workerFactory: fixture.factory });
  t.after(() => pool.stop());
  await pool.start();
  fixture.records[0].healthFailures = 1;

  await pool.heartbeat();
  assert.equal(pool.snapshot().workers[0].status, 'unhealthy');
  await pool.heartbeat();
  assert.equal(pool.snapshot().workers[0].status, 'healthy');
  assert.equal(fixture.records[0].starts, 2);
});

test('uses the worker startup deadline rather than the shorter heartbeat deadline', async (t) => {
  const fixture = createWorkerFactory();
  const baseFactory = fixture.factory;
  const pool = createWorkerPool({
    workerCount: 1,
    heartbeatTimeoutMs: 5,
    workerFactory(options) {
      const worker = baseFactory(options);
      const start = worker.start;
      worker.start = async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return start();
      };
      return worker;
    }
  });
  t.after(() => pool.stop());

  assert.equal((await pool.start()).workers[0].status, 'healthy');
});

test('stops every worker cleanly and rejects new leases after shutdown', async () => {
  const fixture = createWorkerFactory();
  const pool = createWorkerPool({ workerCount: 2, workerFactory: fixture.factory });
  await pool.start();
  await pool.stop();

  assert.deepEqual(fixture.records.map((record) => record.stops), [1, 1]);
  assert.equal(pool.acquire({ conversationId: 'conversation-a' }), null);
  assert.equal(pool.snapshot().status, 'stopped');
});
