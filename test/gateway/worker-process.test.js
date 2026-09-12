'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { createWorkerProcess } = require('../../src/gateway/worker-process');

const FIXTURE = path.resolve(__dirname, '../fixtures/fake-opencode-serve.js');

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function createFixture(t, options = {}) {
  const logs = [];
  const worker = createWorkerProcess({
    command: process.execPath,
    baseArgs: [FIXTURE],
    cwd: path.resolve(__dirname, '../..'),
    port: await getFreePort(),
    expectedVersion: '1.18.25',
    startupTimeoutMs: 1000,
    healthIntervalMs: 10,
    stopGraceMs: 100,
    killGraceMs: 100,
    logger: { log: (message) => logs.push(message), error: (message) => logs.push(message) },
    ...options
  });
  t.after(() => worker.stop().catch(() => {}));
  return { worker, logs };
}

test('starts one authenticated loopback worker and stops it cleanly', async (t) => {
  const { worker, logs } = await createFixture(t, {
    password: 'runtime-worker-secret'
  });

  const started = await worker.start();
  assert.equal(started.status, 'healthy');
  assert.equal(started.endpoint.startsWith('http://127.0.0.1:'), true);
  assert.equal(started.version, '1.18.25');
  assert.equal(Number.isInteger(started.processId), true);
  assert.deepEqual(await worker.health(), { healthy: true, version: '1.18.25' });
  assert.deepEqual(await worker.start(), started);

  const stopped = await worker.stop();
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.processId, null);
  assert.equal(logs.join('\n').includes('runtime-worker-secret'), false);
});

test('generates an in-memory password when none is supplied', async (t) => {
  const { worker } = await createFixture(t);
  assert.equal((await worker.start()).status, 'healthy');
});

test('starts in pure mode with forced workspace tool permissions', async (t) => {
  const spawned = [];
  const child = new EventEmitter();
  child.pid = 43210;
  child.kill = (signal) => {
    setImmediate(() => child.emit('close', 0, signal));
    return true;
  };
  const { worker } = await createFixture(t, {
    env: {
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        model: 'internal/model',
        permission: { bash: 'allow', external_directory: { '/tmp/**': 'allow' } }
      })
    },
    spawnImpl(command, args, options) {
      spawned.push({ command, args, options });
      return child;
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ healthy: true, version: '1.18.25' })
    })
  });

  await worker.start();
  assert.equal(spawned.length, 1);
  assert.ok(spawned[0].args.includes('--pure'));
  const config = JSON.parse(spawned[0].options.env.OPENCODE_CONFIG_CONTENT);
  assert.equal(config.model, 'internal/model');
  assert.equal(config.permission.external_directory, 'deny');
  assert.equal(config.permission.bash, 'deny');
  assert.equal(config.permission.webfetch, 'deny');
  assert.equal(config.permission.websearch, 'deny');
  assert.equal(config.permission.task, 'deny');
});

test('loads an owner-only provider config file before applying forced permissions', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-config-file-'));
  const file = path.join(root, 'opencode.json');
  fs.writeFileSync(file, JSON.stringify({ model: 'internal/model', provider: { internal: { options: { baseURL: 'https://model.intra.example/v1' } } } }), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const spawned = [];
  const child = new EventEmitter(); child.pid = 43211;
  child.kill = (signal) => { setImmediate(() => child.emit('close', 0, signal)); return true; };
  const { worker } = await createFixture(t, {
    env: { OPENCODE_CONFIG_FILE: file },
    spawnImpl(command, args, options) { spawned.push({ command, args, options }); return child; },
    fetchImpl: async () => ({ ok: true, json: async () => ({ healthy: true, version: '1.18.25' }) })
  });
  await worker.start();
  const config = JSON.parse(spawned[0].options.env.OPENCODE_CONFIG_CONTENT);
  assert.equal(config.model, 'internal/model');
  assert.equal(config.provider.internal.options.baseURL, 'https://model.intra.example/v1');
  assert.equal(config.permission.bash, 'deny');
});

test('rejects an unsafe provider config file before spawning', () => {
  assert.throws(() => createWorkerProcess({ command: process.execPath, baseArgs: [FIXTURE], cwd: process.cwd(), port: 4319, env: { OPENCODE_CONFIG_FILE: 'relative.json' } }), (error) => error.code === 'OPENCODE_CONFIG_FILE_INVALID');
});

test('rejects a non-loopback worker configuration before spawning', async () => {
  assert.throws(
    () => createWorkerProcess({
      command: process.execPath,
      baseArgs: [FIXTURE],
      cwd: process.cwd(),
      hostname: '0.0.0.0',
      port: 4319
    }),
    (error) => error.code === 'OPENCODE_WORKER_UNSAFE_BIND'
  );
});

test('maps an executable spawn failure and returns to a stopped state', async (t) => {
  const { worker } = await createFixture(t, {
    command: '/path/that/does/not/exist/opencode',
    startupTimeoutMs: 100,
    stopGraceMs: 20,
    killGraceMs: 20
  });

  await assert.rejects(
    worker.start(),
    (error) => error.code === 'OPENCODE_WORKER_SPAWN_ERROR'
  );
  assert.equal(worker.snapshot().status, 'stopped');
  assert.equal(worker.snapshot().processId, null);
});

test('fails startup on version drift and on a readiness deadline', async (t) => {
  const mismatch = await createFixture(t, {
    env: { ...process.env, FAKE_OPENCODE_VERSION: '1.17.0' }
  });
  await assert.rejects(
    mismatch.worker.start(),
    (error) => error.code === 'OPENCODE_VERSION_MISMATCH'
  );
  assert.equal(mismatch.worker.snapshot().status, 'stopped');

  const delayed = await createFixture(t, {
    env: { ...process.env, FAKE_OPENCODE_START_DELAY_MS: '500' },
    startupTimeoutMs: 50
  });
  await assert.rejects(
    delayed.worker.start(),
    (error) => error.code === 'OPENCODE_WORKER_START_TIMEOUT'
  );
  assert.equal(delayed.worker.snapshot().status, 'stopped');
});

test('marks an unexpected post-readiness exit unhealthy', async (t) => {
  const { worker } = await createFixture(t, {
    env: { ...process.env, FAKE_OPENCODE_EXIT_AFTER_HEALTH_MS: '1' }
  });
  await worker.start();

  const exit = await Promise.race([
    worker.waitForExit(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('fixture did not exit after readiness')), 100))
  ]);

  assert.equal(exit.expected, false);
  assert.equal(exit.code, 71);
  assert.equal(worker.snapshot().status, 'unhealthy');
  assert.equal(worker.snapshot().processId, null);
});

test('escalates shutdown when a worker ignores SIGTERM', async (t) => {
  const { worker } = await createFixture(t, {
    env: { ...process.env, FAKE_OPENCODE_IGNORE_TERM: '1' },
    stopGraceMs: 30,
    killGraceMs: 100
  });
  await worker.start();

  const stopped = await worker.stop();

  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.processId, null);
});
