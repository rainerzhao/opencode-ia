'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');
const { createAuthenticatedWorkbench, authHeaders } = require('../fixtures/authenticated-workbench');
const { createGatewayService } = require('../../src/gateway/gateway-service');
const { createFairQueue } = require('../../src/gateway/fair-queue');
const { createWorkerPool } = require('../../src/gateway/worker-pool');
const { createWorkerProcess } = require('../../src/gateway/worker-process');

// Opt-in sends 45 synthetic prompts through the user's configured OpenCode model.
// Default CI mode exercises the same authenticated HTTP/WS/Gateway path with a fake model.
const real = process.env.WORKBENCH_REAL_ACCEPTANCE === '1';
const multiSession = process.env.WORKBENCH_MULTI_SESSION_ACCEPTANCE === '1';
const workerCount = multiSession ? 1 : 2;
const capacity = multiSession ? 15 : 1;
const globalRunning = multiSession ? 15 : 2;
const userRunning = multiSession ? 3 : 1;

async function until(check, timeout = real ? 240_000 : 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail('acceptance deadline exceeded');
}

test(`5 users × 3 private conversations × 3 solution rounds (${real ? 'REAL OPENCODE' : 'SIMULATED MODEL'})`, { timeout: real ? 900_000 : 30_000 }, async (t) => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-five-users-'));
  let gateway;
  let maxRunning = 0;
  let maxUserRunning = 0;
  let maxQueued = 0;
  const samples = [];
  const sessions = new Map();
  const ports = [];
  if (real) for (let i = 0; i < workerCount; i++) {
    const server = net.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    ports.push(server.address().port);
    await new Promise((resolve) => server.close(resolve));
  }
  const pool = createWorkerPool({
    workerCount, workerCapacity: capacity,
    heartbeatMs: 5000,
    heartbeatFailureThreshold: 3,
    workerFactory: ({ index, onExit }) => {
      if (real) return createWorkerProcess({
        command: process.env.OPENCODE_CMD || 'opencode',
        cwd: workspaceRoot,
        env: { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission: 'deny' }) },
        hostname: '127.0.0.1', port: ports[index], onExit,
        spawnImpl(command, args, options) {
          const child = spawn(command, args, { ...options, stdio: ['ignore', 'ignore', 'pipe'] });
          let diagnostic = '';
          child.stderr.on('data', (chunk) => { diagnostic = (diagnostic + chunk).slice(-8192); });
          child.on('close', (code, signal) => {
            if (code) t.diagnostic(JSON.stringify({ worker: index, exitCode: code, signal,
              portConflict: /EADDRINUSE|address already in use/i.test(diagnostic),
              databaseError: /SQLITE|database.*(?:lock|error)/i.test(diagnostic),
              configError: /config.*(?:invalid|error)|Invalid config/i.test(diagnostic),
              filesystemError: /ENOENT|EACCES|EPERM/i.test(diagnostic),
              optionError: /unknown option|unrecognized|Usage:/i.test(diagnostic) }));
          });
          return child;
        },
        logger: { log() {}, error() {} }
      });
      return {
        start: async () => ({ status: 'healthy' }), stop: async () => {},
        health: async () => ({ healthy: true }), snapshot: () => ({ status: 'healthy', version: 'fake' }),
        client: {
          createSession: async () => { const id = `${index}-${crypto.randomUUID()}`; sessions.set(id, []); return { id }; },
          prompt: async ({ sessionId, text }) => {
            const history = sessions.get(sessionId);
            assert.ok(history);
            history.push(text);
            await new Promise((resolve) => setTimeout(resolve, 30));
            const marker = history[0].match(/CASE_[a-f0-9]+/)?.[0];
            return { parts: [{ type: 'text', text: `${marker}：方案第 ${history.length} 轮，需求、风险与验收已更新。` }] };
          },
          abortSession: async () => true
        }
      };
    }
  });
  t.after(async () => {
    await gateway?.stop();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });
  const fixture = await createAuthenticatedWorkbench(t, {
    maxSessions: 20,
    gatewayServiceFactory: ({ store }) => {
      gateway = createGatewayService({ store, pool, workspaceRoot, queue: createFairQueue({ maxQueuedPerUser: 3 }), limits: { globalRunning, userRunning, jobTimeoutMs: real ? 120_000 : 5000 } });
      return gateway;
    }
  });
  await gateway.start();
  const members = [];
  for (let user = 0; user < 5; user++) members.push(await fixture.createMember({ username: `load.member.${user}` }));
  const tracks = await Promise.all(members.flatMap((member, user) => Array.from({ length: 3 }, async (_, conversation) => {
    const response = await fetch(`${fixture.origin}/api/conversations`, { method: 'POST', headers: authHeaders(member, { json: true }), body: JSON.stringify({ title: `方案 ${user}-${conversation}` }) });
    assert.equal(response.status, 201);
    const { conversation: record } = await response.json();
    const ws = new WebSocket(fixture.origin.replace('http:', 'ws:'), { headers: { cookie: member.cookie } });
    const messages = [];
    ws.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
    ws.on('error', () => {});
    t.after(() => ws.terminate());
    await until(() => messages.some((message) => message.type === 'connected'));
    ws.send(JSON.stringify({ type: 'subscribe', conversationId: record.id, afterSequence: 0 }));
    await until(() => messages.some((message) => message.type === 'conversation.snapshot'));
    return { ws, messages, member, record, marker: `CASE_${crypto.randomBytes(8).toString('hex')}` };
  })));
  for (let round = 0; round < 3; round++) {
    const since = Date.now();
    for (const track of tracks) {
      const text = round === 0
        ? `我们讨论一个企业内部知识库试点方案。方案标识 ${track.marker}，预算 10 万，周期 4 周。请首先原样输出方案标识，再给出两个实施步骤。本轮和以后每轮回答必须保留本方案标识，只基于当前会话。不要使用工具，每次回答不超过 100 字。`
        : round === 1 ? '沿用上轮标识、预算和周期，补充两个风险及应对。不要使用工具，不超过 100 字。'
          : '沿用前两轮方案标识，汇总实施步骤并给出两个可量化验收条件，保留预算和周期。不要使用工具，不超过 100 字。';
      track.ws.send(JSON.stringify({ type: 'prompt', conversationId: track.record.id, idempotencyKey: `${track.record.id}-round-${round}`, text }));
    }
    await until(() => {
      const snapshot = gateway.snapshot();
      maxRunning = Math.max(maxRunning, snapshot.running);
      maxQueued = Math.max(maxQueued, snapshot.queue.totalQueued);
      const counts = new Map();
      for (const track of tracks) {
        const failed = track.messages.find((event) => event.type === 'error' || ['job.failed', 'job.interrupted', 'job.timed_out'].includes(event.type));
        assert.ok(!failed, `round ${round + 1}: ${failed?.code || failed?.type || ''} ${failed?.data?.errorCode || ''}`);
        const current = track.messages.filter((event) => event.type === 'job.started').at(-1);
        if (current && !track.messages.some((event) => event.jobId === current.jobId && event.type === 'job.completed')) counts.set(track.member.user.id, (counts.get(track.member.user.id) || 0) + 1);
      }
      maxUserRunning = Math.max(maxUserRunning, ...counts.values());
      return tracks.every((track) => track.messages.filter((event) => event.type === 'job.completed').length === round + 1);
    });
    samples.push(Date.now() - since);
    for (const track of tracks) {
      const completed = track.messages.filter((event) => event.type === 'job.completed').at(-1);
      const answer = track.messages.filter((event) => event.jobId === completed.jobId && event.type === 'message.delta').map((event) => event.data.text).join('');
      assert.ok(answer.includes(track.marker), `round ${round + 1}: context marker lost; answer characters=${answer.length}`);
      for (const other of tracks) if (other !== track) assert.ok(!answer.includes(other.marker), 'cross-conversation context leak');
    }
    t.diagnostic(`round ${round + 1}: 15/15 completed, context markers isolated, ${samples.at(-1)} ms`);
  }
  for (let index = 0; index < members.length; index++) {
    const member = members[index];
    const response = await fetch(`${fixture.origin}/api/conversations`, { headers: authHeaders(member) });
    assert.equal((await response.json()).conversations.length, 3);
    const other = tracks.find((track) => track.member !== member);
    const denied = await fetch(`${fixture.origin}/api/conversations/${other.record.id}`, { headers: authHeaders(member) });
    assert.equal(denied.status, 404);
  }
  assert.equal(maxRunning, globalRunning);
  assert.ok(maxUserRunning <= userRunning);
  if (!multiSession) assert.ok(maxQueued > 0);
  t.diagnostic(JSON.stringify({ mode: real ? 'real' : 'simulated', workerCount, capacity, users: 5, conversations: 15, rounds: 3, completed: 45, maxRunning, maxUserRunning, maxQueued, roundMilliseconds: samples }));
});
