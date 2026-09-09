'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');
const { createAuthenticatedWorkbench, authHeaders } = require('../fixtures/authenticated-workbench');
const { createFairQueue } = require('../../src/gateway/fair-queue');
const { createGatewayService } = require('../../src/gateway/gateway-service');
const { createWorkerPool } = require('../../src/gateway/worker-pool');
const { createWorkerProcess } = require('../../src/gateway/worker-process');

const enabled = process.env.WORKBENCH_RUNTIME_CRASH_ACCEPTANCE === '1';

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function until(check, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail('runtime crash acceptance deadline exceeded');
}

async function untilJob(messages, jobId, expectedType, timeout = 120_000) {
  return until(() => {
    const terminal = messages.find((event) => event.jobId === jobId && [
      'job.completed',
      'job.failed',
      'job.interrupted'
    ].includes(event.type));
    if (!terminal || terminal.type === expectedType) return terminal;
    assert.fail(`job ${jobId} ended as ${terminal.type}: ${terminal.data?.errorCode || 'no error code'}`);
  }, timeout);
}

function answerFor(messages, jobId) {
  return messages
    .filter((event) => event.jobId === jobId && event.type === 'message.delta')
    .map((event) => event.data.text)
    .join('');
}

test('real OpenCode crash interrupts active work and either restores or safely closes its session', {
  skip: !enabled,
  timeout: 600_000
}, async (t) => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-runtime-crash-'));
  const port = await reservePort();
  const marker = `CRASH_CASE_${crypto.randomBytes(8).toString('hex')}`;
  let gateway;
  let store;
  let runtimeWorker;

  const pool = createWorkerPool({
    workerCount: 1,
    workerCapacity: 1,
    heartbeatMs: 5_000,
    heartbeatTimeoutMs: 2_000,
    heartbeatFailureThreshold: 3,
    workerFactory: ({ onExit }) => {
      runtimeWorker = createWorkerProcess({
        command: process.env.OPENCODE_CMD || 'opencode',
        cwd: workspaceRoot,
        env: {
          ...process.env,
          OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission: 'deny' })
        },
        hostname: '127.0.0.1',
        port,
        expectedVersion: process.env.OPENCODE_VERIFIED_VERSION || '1.18.25',
        startupTimeoutMs: 30_000,
        promptTimeoutMs: 120_000,
        healthIntervalMs: 100,
        stopGraceMs: 2_000,
        killGraceMs: 1_000,
        logger: { log() {}, error() {} },
        onExit
      });
      return runtimeWorker;
    }
  });

  const fixture = await createAuthenticatedWorkbench(t, {
    gatewayServiceFactory: ({ store: gatewayStore }) => {
      store = gatewayStore;
      gateway = createGatewayService({
        store,
        pool,
        workspaceRoot,
        queue: createFairQueue({ maxQueuedPerUser: 3 }),
        limits: { globalRunning: 1, userRunning: 1, jobTimeoutMs: 120_000 }
      });
      return gateway;
    }
  });
  t.after(async () => {
    await gateway?.stop().catch(() => {});
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  await gateway.start();
  const member = await fixture.createMember({ username: 'runtime.crash.member' });
  const created = await fetch(`${fixture.origin}/api/conversations`, {
    method: 'POST',
    headers: authHeaders(member, { json: true }),
    body: JSON.stringify({ title: 'Runtime 崩溃恢复演练' })
  });
  assert.equal(created.status, 201);
  const { conversation } = await created.json();

  const ws = new WebSocket(fixture.origin.replace('http:', 'ws:'), {
    headers: { cookie: member.cookie }
  });
  const messages = [];
  ws.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
  ws.on('error', () => {});
  t.after(() => ws.terminate());
  await until(() => messages.some((message) => message.type === 'connected'));
  ws.send(JSON.stringify({
    type: 'subscribe',
    conversationId: conversation.id,
    afterSequence: 0
  }));
  await until(() => messages.some((message) => message.type === 'conversation.snapshot'));

  ws.send(JSON.stringify({
    type: 'prompt',
    conversationId: conversation.id,
    idempotencyKey: 'runtime-crash-round-1',
    text: `记住唯一标识 ${marker}。只原样输出该标识，不要使用工具。`
  }));
  const firstAccepted = await until(() => messages.find((message) =>
    message.type === 'job.accepted' && message.deduplicated === false
  ));
  await untilJob(messages, firstAccepted.jobId, 'job.completed');
  assert.match(answerFor(messages, firstAccepted.jobId), new RegExp(marker));

  const originalBinding = store.getOpenCodeSession({ conversationId: conversation.id });
  assert.equal(originalBinding.recoveryStatus, 'active');
  const originalWorker = gateway.snapshot().pool.workers[0];
  assert.equal(originalWorker.status, 'healthy');
  assert.ok(Number.isInteger(originalWorker.processId) && originalWorker.processId > 1);

  ws.send(JSON.stringify({
    type: 'prompt',
    conversationId: conversation.id,
    idempotencyKey: 'runtime-crash-round-2',
    text: '继续思考上轮内容，稍后再回答；不要使用工具。'
  }));
  const secondAccepted = await until(() => messages.filter((message) =>
    message.type === 'job.accepted'
  )[1]);
  await until(() => messages.find((message) =>
    message.type === 'job.started' && message.jobId === secondAccepted.jobId
  ));

  ws.send(JSON.stringify({
    type: 'prompt',
    conversationId: conversation.id,
    idempotencyKey: 'runtime-crash-round-3',
    text: '原样输出第一轮的唯一标识，不要使用工具。'
  }));
  const thirdAccepted = await until(() => messages.filter((message) =>
    message.type === 'job.accepted'
  )[2]);

  const killTarget = gateway.snapshot().pool.workers[0];
  assert.equal(killTarget.status, 'healthy');
  assert.equal(killTarget.processId, originalWorker.processId);
  process.kill(killTarget.processId, 'SIGKILL');
  await untilJob(messages, secondAccepted.jobId, 'job.interrupted');
  const restartedWorker = await until(() => {
    const worker = gateway.snapshot().pool.workers[0];
    return worker.status === 'healthy' && worker.processId &&
      worker.processId !== originalWorker.processId ? worker : null;
  });
  assert.notEqual(restartedWorker.processId, originalWorker.processId);

  const recoveredBinding = await until(() => {
    const binding = store.getOpenCodeSession({ conversationId: conversation.id });
    return binding?.recoveryStatus !== 'recovering' ? binding : null;
  });
  if (recoveredBinding.recoveryStatus === 'active') {
    assert.equal(recoveredBinding.opencodeSessionId, originalBinding.opencodeSessionId);
    try {
      await untilJob(messages, thirdAccepted.jobId, 'job.completed');
    } catch (error) {
      t.diagnostic(JSON.stringify({
        phase: 'restored-session-follow-up',
        originalProcessId: originalWorker.processId,
        restartedProcessId: restartedWorker.processId,
        currentPool: gateway.snapshot().pool,
        currentBinding: store.getOpenCodeSession({ conversationId: conversation.id }),
        terminalEvents: messages.filter((message) =>
          message.jobId === thirdAccepted.jobId && message.type.startsWith('job.')
        ).map((message) => ({ type: message.type, errorCode: message.data?.errorCode || null }))
      }));
      throw error;
    }
    const restoredAnswer = answerFor(messages, thirdAccepted.jobId);
    if (!restoredAnswer) {
      const sessionMessages = await runtimeWorker.client.requestJson(
        `/session/${encodeURIComponent(recoveredBinding.opencodeSessionId)}/message?limit=100`,
        { directory: recoveredBinding.workspacePath }
      );
      t.diagnostic(JSON.stringify({
        phase: 'restored-session-empty-answer',
        messages: sessionMessages.map((message) => ({
          role: message?.info?.role || null,
          parentId: message?.info?.parentID || null,
          completed: Boolean(message?.info?.time?.completed),
          hasError: Boolean(message?.info?.error),
          parts: Array.isArray(message?.parts) ? message.parts.map((part) => ({
            type: part?.type || null,
            textLength: typeof part?.text === 'string' ? part.text.length : null,
            tool: part?.tool || null,
            status: part?.state?.status || null
          })) : []
        }))
      }));
    }
    assert.match(restoredAnswer, new RegExp(marker));
    t.diagnostic(JSON.stringify({
      result: 'session-restored',
      originalProcessId: originalWorker.processId,
      restartedProcessId: restartedWorker.processId,
      sameSession: true
    }));
  } else {
    assert.equal(recoveredBinding.recoveryStatus, 'unavailable');
    await untilJob(messages, thirdAccepted.jobId, 'job.interrupted');
    assert.equal(answerFor(messages, thirdAccepted.jobId), '');
    assert.ok(messages.some((message) => message.type === 'conversation.recovery_boundary'));
    t.diagnostic(JSON.stringify({
      result: 'session-unavailable-safe-boundary',
      originalProcessId: originalWorker.processId,
      restartedProcessId: restartedWorker.processId
    }));
  }
});
