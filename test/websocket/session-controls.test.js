'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const WebSocket = require('ws');
const { loadConfig } = require('../../src/config');
const { createWorkbenchServer } = require('../../src/create-workbench-server');
const { createPromptRunner } = require('../../src/opencode/run-prompt');

const fixturePath = path.resolve(__dirname, '../fixtures/fake-opencode.js');

function useTempDir(t) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-server-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  return tempDir;
}

function waitForJson(ws, predicate = () => true, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('timed out waiting for WebSocket message'));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timeout);
      ws.off('message', onMessage);
      ws.off('error', onError);
    }
    function onMessage(data) {
      const message = JSON.parse(data.toString());
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    }
    function onError(error) {
      cleanup();
      reject(error);
    }
    ws.on('message', onMessage);
    ws.on('error', onError);
  });
}

function waitForClose(ws, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('timed out waiting for WebSocket close'));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timeout);
      ws.off('close', onClose);
      ws.off('error', onError);
    }
    function onClose(code, reason) {
      cleanup();
      resolve({ code, reason: reason.toString() });
    }
    function onError(error) {
      cleanup();
      reject(error);
    }
    ws.on('close', onClose);
    ws.on('error', onError);
  });
}

function terminateSocket(ws) {
  if (!ws || ws.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    ws.once('close', resolve);
    ws.terminate();
  });
}

async function waitForFileContent(filePath, expected, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for complete file: ${path.basename(filePath)}`);
}

async function fetchConfig(port) {
  const response = await fetch(`http://127.0.0.1:${port}/api/config`);
  assert.equal(response.status, 200);
  return response.json();
}

function withTimeout(promise, message, timeoutMs = 1000) {
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      timeout.unref();
    })
  ]);
}

function verifyPortCanBeRebound(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => {
      probe.close((error) => error ? reject(error) : resolve());
    });
  });
}

test('starts on an ephemeral port and stops cleanly', async (t) => {
  const projectDir = useTempDir(t);
  const config = loadConfig({ env: {}, projectDir });
  const workbench = createWorkbenchServer({
    config,
    promptRunner: { runPrompt: async () => ({ text: 'unused', stderr: '', events: [] }) },
    logger: { log() {}, error() {} }
  });
  t.after(() => workbench.stop());

  const address = await workbench.start(0);
  const response = await fetch(`http://127.0.0.1:${address.port}/api/config`);

  assert.equal(response.status, 200);
  assert.equal((await response.json()).activeSessions, 0);

  await workbench.stop();
});

test('makes start and stop idempotent and rejects restart after shutdown', async (t) => {
  const projectDir = useTempDir(t);
  const config = loadConfig({ env: {}, projectDir });
  const workbench = createWorkbenchServer({
    config,
    promptRunner: { runPrompt: async () => ({ text: 'unused', stderr: '', events: [] }) },
    logger: { log() {}, error() {} }
  });

  const firstAddress = await workbench.start(0);
  const secondAddress = await workbench.start(12345);
  assert.deepEqual(secondAddress, firstAddress);

  const firstStop = workbench.stop();
  const secondStop = workbench.stop();
  assert.equal(secondStop, firstStop);
  await firstStop;

  await assert.rejects(
    workbench.start(0),
    (error) => error.code === 'SERVER_STOPPED'
  );
  assert.equal(workbench.httpServer.listening, false);
});

test('settles an in-flight start when stop is called immediately', async (t) => {
  const projectDir = useTempDir(t);
  const config = loadConfig({ env: {}, projectDir });
  const workbench = createWorkbenchServer({
    config,
    promptRunner: { runPrompt: async () => ({ text: 'unused', stderr: '', events: [] }) },
    logger: { log() {}, error() {} }
  });

  const startPromise = workbench.start(0);
  const stopPromise = workbench.stop();

  await assert.rejects(
    withTimeout(startPromise, 'start promise remained pending after stop'),
    (error) => error.code === 'SERVER_STOPPED'
  );
  await withTimeout(stopPromise, 'stop did not settle after cancelling startup');
  assert.equal(workbench.httpServer.listening, false);
});

test('rejects a WebSocket connection when the global session limit is reached', async (t) => {
  const projectDir = useTempDir(t);
  const config = loadConfig({ env: { MAX_SESSIONS: '1' }, projectDir });
  const workbench = createWorkbenchServer({
    config,
    promptRunner: { runPrompt: async () => ({ text: 'unused', stderr: '', events: [] }) },
    logger: { log() {}, error() {} }
  });
  const address = await workbench.start(0);
  const url = `ws://127.0.0.1:${address.port}`;
  let first;
  let second;
  try {
    first = new WebSocket(url);
    assert.equal((await waitForJson(first)).type, 'connected');

    second = new WebSocket(url);
    const closed = await waitForClose(second);

    assert.deepEqual(closed, {
      code: 1013,
      reason: 'MAX_SESSIONS_REACHED'
    });
  } finally {
    await Promise.all([terminateSocket(first), terminateSocket(second)]);
    await workbench.stop();
  }
});

test('rejects concurrent input in one session without starting a second run', async (t) => {
  const projectDir = useTempDir(t);
  const config = loadConfig({ env: {}, projectDir });
  const fixtureRunner = createPromptRunner({
    command: process.execPath,
    baseArgs: [fixturePath],
    cwd: projectDir,
    timeoutMs: 2000,
    maxOutputBytes: 1024 * 1024,
    killGraceMs: 100
  });
  let runCount = 0;
  const promptRunner = {
    runPrompt(input, options) {
      runCount += 1;
      return fixtureRunner.runPrompt(input, options);
    }
  };
  const workbench = createWorkbenchServer({
    config,
    promptRunner,
    logger: { log() {}, error() {} }
  });
  const address = await workbench.start(0);
  const ws = new WebSocket(`ws://127.0.0.1:${address.port}`);

  try {
    await waitForJson(ws, (message) => message.type === 'connected');
    ws.send(JSON.stringify({ type: 'input', data: '__TEST_DELAY__' }));
    await waitForJson(ws, (message) => message.type === 'thinking');

    ws.send(JSON.stringify({ type: 'input', data: 'must-not-start' }));
    const error = await waitForJson(ws, (message) => message.type === 'error');

    assert.equal(error.code, 'SESSION_BUSY');
    assert.equal(error.message, 'A request is already running for this session');
    assert.equal(runCount, 1);
  } finally {
    await terminateSocket(ws);
    await workbench.stop();
  }
});

test('maps runner failures to stable WebSocket errors without leaking details', async (t) => {
  const projectDir = useTempDir(t);
  const config = loadConfig({ env: {}, projectDir });
  const leakedDetail = 'secret-command --token should-never-reach-the-client';
  const workbench = createWorkbenchServer({
    config,
    promptRunner: {
      async runPrompt() {
        const error = new Error(leakedDetail);
        error.code = 'UNEXPECTED_INTERNAL_FAILURE';
        throw error;
      }
    },
    logger: { log() {}, error() {} }
  });
  const address = await workbench.start(0);
  const ws = new WebSocket(`ws://127.0.0.1:${address.port}`);

  try {
    await waitForJson(ws, (message) => message.type === 'connected');
    ws.send(JSON.stringify({ type: 'input', data: 'trigger-safe-error' }));
    const error = await waitForJson(ws, (message) => message.type === 'error');

    assert.deepEqual(error, {
      type: 'error',
      code: 'OPENCODE_ERROR',
      message: 'OpenCode request failed'
    });
    assert.equal(JSON.stringify(error).includes(leakedDetail), false);
  } finally {
    await terminateSocket(ws);
    await workbench.stop();
  }
});

test('returns stable safe errors for malformed WebSocket messages', async (t) => {
  const projectDir = useTempDir(t);
  const config = loadConfig({ env: {}, projectDir });
  const workbench = createWorkbenchServer({
    config,
    promptRunner: { runPrompt: async () => ({ text: 'unused', stderr: '', events: [] }) },
    logger: { log() {}, error() {} }
  });
  const address = await workbench.start(0);
  const ws = new WebSocket(`ws://127.0.0.1:${address.port}`);

  try {
    await waitForJson(ws, (message) => message.type === 'connected');

    ws.send('{not-json');
    assert.deepEqual(await waitForJson(ws, (message) => message.type === 'error'), {
      type: 'error',
      code: 'INVALID_MESSAGE',
      message: 'Message must be valid JSON input'
    });

    ws.send(JSON.stringify({ type: 'input', data: { unexpected: 'object' } }));
    assert.deepEqual(await waitForJson(ws, (message) => message.type === 'error'), {
      type: 'error',
      code: 'INVALID_MESSAGE',
      message: 'Message must contain string input data'
    });
  } finally {
    await terminateSocket(ws);
    await workbench.stop();
  }
});

test('aborts the active child process when its WebSocket disconnects', async (t) => {
  const projectDir = useTempDir(t);
  const marker = path.join(projectDir, 'socket-close-terminated');
  const config = loadConfig({ env: {}, projectDir });
  const fixtureRunner = createPromptRunner({
    command: process.execPath,
    baseArgs: [fixturePath, `--term-marker=${marker}`],
    cwd: projectDir,
    timeoutMs: 2000,
    maxOutputBytes: 1024 * 1024,
    killGraceMs: 100
  });
  let signalReady;
  const ready = new Promise((resolve) => { signalReady = resolve; });
  const promptRunner = {
    runPrompt(input, options) {
      return fixtureRunner.runPrompt(input, {
        ...options,
        onEvent(event) {
          options.onEvent?.(event);
          if (event.type === 'fixture-ready') signalReady();
        }
      });
    }
  };
  const workbench = createWorkbenchServer({
    config,
    promptRunner,
    logger: { log() {}, error() {} }
  });
  const address = await workbench.start(0);
  const ws = new WebSocket(`ws://127.0.0.1:${address.port}`);

  try {
    await waitForJson(ws, (message) => message.type === 'connected');
    ws.send(JSON.stringify({ type: 'input', data: '__TEST_DELAY__' }));
    await ready;

    await terminateSocket(ws);
    await waitForFileContent(marker, 'terminated');
  } finally {
    await terminateSocket(ws);
    await workbench.stop();
  }
});

test('removes a disconnected session from the active session count', async (t) => {
  const projectDir = useTempDir(t);
  const config = loadConfig({ env: {}, projectDir });
  const workbench = createWorkbenchServer({
    config,
    promptRunner: { runPrompt: async () => ({ text: 'unused', stderr: '', events: [] }) },
    logger: { log() {}, error() {} }
  });
  const address = await workbench.start(0);
  const ws = new WebSocket(`ws://127.0.0.1:${address.port}`);

  try {
    await waitForJson(ws, (message) => message.type === 'connected');
    assert.equal((await fetchConfig(address.port)).activeSessions, 1);

    await terminateSocket(ws);

    assert.equal((await fetchConfig(address.port)).activeSessions, 0);
  } finally {
    await terminateSocket(ws);
    await workbench.stop();
  }
});

test('forces hanging HTTP connections closed within the shutdown deadline', async (t) => {
  const projectDir = useTempDir(t);
  const config = loadConfig({
    env: { KNOWLEDGE_FETCH_ALLOWED_HOSTS: 'docs.example.com' },
    projectDir
  });
  let signalUpstreamRequest;
  const upstreamRequested = new Promise((resolve) => { signalUpstreamRequest = resolve; });
  let signalUpstreamSocketClosed;
  const upstreamSocketClosed = new Promise((resolve) => { signalUpstreamSocketClosed = resolve; });
  const hangingUpstream = http.createServer((request, response) => {
    signalUpstreamRequest();
    request.socket.once('close', signalUpstreamSocketClosed);
    request.on('close', () => response.destroy());
  });
  await new Promise((resolve, reject) => {
    hangingUpstream.once('error', reject);
    hangingUpstream.listen(0, '127.0.0.1', resolve);
  });
  const upstreamPort = hangingUpstream.address().port;

  const workbench = createWorkbenchServer({
    config,
    promptRunner: { runPrompt: async () => ({ text: 'unused', stderr: '', events: [] }) },
    logger: { log() {}, error() {} },
    urlFetchOptions: {
      resolver: async () => [{ address: '93.184.216.34', family: 4 }],
      fetchImpl: (url, options) => {
        const source = new URL(url);
        return fetch(`http://127.0.0.1:${upstreamPort}${source.pathname}`, options);
      }
    }
  });
  const address = await workbench.start(0);
  const pendingRequest = fetch(`http://127.0.0.1:${address.port}/api/knowledge/fetch-url`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://docs.example.com/never-finishes' })
  });

  try {
    await withTimeout(upstreamRequested, 'workbench did not start the upstream request');
    await withTimeout(workbench.stop(), 'server stop hung on an active HTTP request', 500);
    await withTimeout(upstreamSocketClosed, 'server stop left the outbound fetch socket open', 500);
    const requestOutcome = await pendingRequest.then(
      (response) => ({ status: response.status }),
      (error) => ({ error })
    );
    assert.equal(
      requestOutcome.status === 499 || requestOutcome.status === 500 || requestOutcome.error instanceof Error,
      true
    );
    assert.equal(workbench.httpServer.listening, false);
    await verifyPortCanBeRebound(address.port);
  } finally {
    hangingUpstream.closeAllConnections?.();
    await new Promise((resolve) => hangingUpstream.close(() => resolve()));
    await workbench.stop();
  }
});

test('stop closes sockets, aborts active runs, and releases the bound port', async (t) => {
  const projectDir = useTempDir(t);
  const marker = path.join(projectDir, 'server-stop-terminated');
  const config = loadConfig({ env: {}, projectDir });
  const fixtureRunner = createPromptRunner({
    command: process.execPath,
    baseArgs: [fixturePath, `--term-marker=${marker}`],
    cwd: projectDir,
    timeoutMs: 2000,
    maxOutputBytes: 1024 * 1024,
    killGraceMs: 100
  });
  let signalReady;
  const ready = new Promise((resolve) => { signalReady = resolve; });
  const promptRunner = {
    runPrompt(input, options) {
      return fixtureRunner.runPrompt(input, {
        ...options,
        onEvent(event) {
          options.onEvent?.(event);
          if (event.type === 'fixture-ready') signalReady();
        }
      });
    }
  };
  const workbench = createWorkbenchServer({
    config,
    promptRunner,
    logger: { log() {}, error() {} }
  });
  const address = await workbench.start(0);
  const ws = new WebSocket(`ws://127.0.0.1:${address.port}`);
  let stopPromise;

  try {
    await waitForJson(ws, (message) => message.type === 'connected');
    ws.send(JSON.stringify({ type: 'input', data: '__TEST_DELAY__' }));
    await ready;

    stopPromise = workbench.stop();
    await withTimeout(stopPromise, 'server stop did not close active WebSockets');
    await waitForFileContent(marker, 'terminated');
    if (ws.readyState !== WebSocket.CLOSED) await waitForClose(ws);

    assert.equal(ws.readyState, WebSocket.CLOSED);
    assert.equal(workbench.sessions.size, 0);
    assert.equal(workbench.httpServer.listening, false);
    await verifyPortCanBeRebound(address.port);
  } finally {
    await terminateSocket(ws);
    if (stopPromise) await stopPromise;
    else await workbench.stop();
  }
});
