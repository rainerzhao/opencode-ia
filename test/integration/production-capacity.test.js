'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');
const { createMySqlProductionWorkbench } = require('../../apps/server');
const { loadProductionCapacityProfile } = require('../../src/gateway/production-capacity-profile');
const { validateProductionConfig } = require('../../scripts/check-production-config');
const { validateOpenCodeProviderConfig } = require('../../scripts/check-opencode-provider');
const { authHeaders, login, readJson } = require('../fixtures/authenticated-workbench');
const { runAdminCli } = require('../fixtures/admin-cli');

const enabled = process.env.WORKBENCH_PRODUCTION_CAPACITY_ACCEPTANCE === '1';

async function reservePortBlock(size) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const probe = net.createServer();
    await new Promise((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', resolve);
    });
    const base = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    if (base + size - 1 > 65535) continue;
    const held = [];
    try {
      for (let offset = 0; offset < size; offset += 1) {
        const server = net.createServer();
        await new Promise((resolve, reject) => {
          server.once('error', reject);
          server.listen(base + offset, '127.0.0.1', resolve);
        });
        held.push(server);
      }
      await Promise.all(held.map((server) => new Promise((resolve) => server.close(resolve))));
      return base;
    } catch {
      await Promise.all(held.map((server) => new Promise((resolve) => server.close(resolve))));
    }
  }
  throw new Error('unable to reserve a contiguous OpenCode worker port block');
}

async function until(check, timeoutMs = 900_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail('production capacity acceptance deadline exceeded');
}

async function expectJsonStatus(responsePromise, expected, operation) {
  const response = await responsePromise;
  if (response.status !== expected) {
    await response.body?.cancel().catch(() => {});
    assert.fail(`${operation} returned HTTP ${response.status}`);
  }
  return readJson(response);
}

test('twenty users complete isolated multi-round work through MySQL production and real OpenCode', {
  skip: !enabled,
  timeout: 3_600_000
}, async (t) => {
  const profile = loadProductionCapacityProfile();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'production-capacity-'));
  const workerBasePort = await reservePortBlock(profile.workerCount);
  const adminPassword = `Capacity Admin ${crypto.randomBytes(16).toString('hex')}!`;
  const memberPassword = `Capacity Member ${crypto.randomBytes(16).toString('hex')}!`;
  const runMarker = crypto.randomBytes(6).toString('hex');
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    WORKBENCH_DATA_DIR: path.join(root, 'data'),
    OPENCODE_CWD: path.join(root, 'runtime'),
    OPENCODE_WORKER_BASE_PORT: String(workerBasePort),
    COOKIE_SECURE: 'true'
  };
  fs.mkdirSync(env.OPENCODE_CWD, { recursive: true });
  validateProductionConfig({
    env,
    projectDir: path.resolve(__dirname, '../..'),
    uid: process.getuid?.()
  });
  validateOpenCodeProviderConfig({ env, uid: process.getuid?.() });

  const bootstrap = await runAdminCli({
    root,
    url: env.WORKBENCH_DATABASE_URL,
    username: 'capacity.admin',
    password: adminPassword,
    env
  });
  assert.equal(bootstrap.code, 0, `fresh acceptance database bootstrap failed: ${bootstrap.stderr.trim()}`);

  const workbench = await createMySqlProductionWorkbench({
    env,
    projectDir: path.resolve(__dirname, '../..'),
    logger: { log() {}, error() {} }
  });
  let stopped = false;
  const sockets = [];
  t.after(async () => {
    for (const socket of sockets) socket.terminate();
    if (!stopped) await workbench.stop().catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  });
  const address = await workbench.start(0, '127.0.0.1');
  const origin = `http://127.0.0.1:${address.port}`;
  const admin = await login(origin, 'capacity.admin', adminPassword);
  assert.equal(admin.response.status, 200, 'capacity administrator login failed');

  const members = [];
  for (let index = 0; index < profile.users; index += 1) {
    const username = `capacity.member.${String(index).padStart(2, '0')}`;
    const created = await expectJsonStatus(fetch(`${origin}/api/admin/users`, {
      method: 'POST',
      headers: authHeaders(admin, { json: true }),
      body: JSON.stringify({ username, displayName: `Capacity Member ${index + 1}`, password: memberPassword, role: 'member' })
    }), 201, 'member creation');
    const session = await login(origin, username, memberPassword);
    assert.equal(session.response.status, 200, `member ${index + 1} login failed`);
    members.push({ ...session, user: created.user });
  }

  const tracks = [];
  for (const [userIndex, member] of members.entries()) {
    const socket = new WebSocket(origin.replace('http:', 'ws:'), {
      headers: { cookie: member.cookie }
    });
    sockets.push(socket);
    const messages = [];
    socket.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
    socket.on('error', () => {});
    await until(() => messages.some((message) => message.type === 'connected'));
    for (let conversationIndex = 0; conversationIndex < profile.conversationsPerUser; conversationIndex += 1) {
      const body = await expectJsonStatus(fetch(`${origin}/api/conversations`, {
        method: 'POST',
        headers: authHeaders(member, { json: true }),
        body: JSON.stringify({ title: `容量验收 ${runMarker}-${userIndex}-${conversationIndex}` })
      }), 201, 'conversation creation');
      socket.send(JSON.stringify({ type: 'subscribe', conversationId: body.conversation.id, afterSequence: 0 }));
      await until(() => messages.some((message) =>
        message.type === 'conversation.snapshot' && message.conversationId === body.conversation.id
      ));
      tracks.push({
        member,
        socket,
        messages,
        conversation: body.conversation,
        marker: `CAP_${runMarker}_${userIndex}_${conversationIndex}`
      });
    }
  }

  let maxRunning = 0;
  let maxUserRunning = 0;
  let maxQueued = 0;
  const roundMilliseconds = [];
  for (let round = 0; round < profile.rounds; round += 1) {
    const startedAt = Date.now();
    for (const track of tracks) {
      const text = round === 0
        ? `只原样输出唯一标识 ${track.marker}，再用一句话说明已建立独立上下文。不要使用工具。`
        : `只原样输出本会话第一轮唯一标识 ${track.marker}，再写“第 ${round + 1} 轮”。不要使用工具。`;
      track.socket.send(JSON.stringify({
        type: 'prompt',
        conversationId: track.conversation.id,
        idempotencyKey: `${track.conversation.id}-round-${round}`,
        text
      }));
    }

    await until(async () => {
      const [health, jobMetadata] = await Promise.all([
        expectJsonStatus(fetch(`${origin}/api/admin/gateway/health`, {
          headers: authHeaders(admin)
        }), 200, 'gateway health sample'),
        expectJsonStatus(fetch(`${origin}/api/admin/gateway/jobs`, {
          headers: authHeaders(admin)
        }), 200, 'gateway job sample')
      ]);
      maxRunning = Math.max(maxRunning, health.running);
      maxQueued = Math.max(maxQueued, health.queued);
      const runningByUser = new Map();
      for (const job of jobMetadata.jobs.filter((item) => item.status === 'running')) {
        runningByUser.set(job.userId, (runningByUser.get(job.userId) || 0) + 1);
      }
      const currentMaxUserRunning = Math.max(0, ...runningByUser.values());
      assert.ok(currentMaxUserRunning <= profile.userRunning, 'single-user running limit exceeded');
      maxUserRunning = Math.max(maxUserRunning, currentMaxUserRunning);
      for (const track of tracks) {
        const terminal = track.messages.find((event) =>
          event.conversationId === track.conversation.id
          && ['error', 'job.failed', 'job.interrupted', 'job.timed_out'].includes(event.type)
        );
        assert.ok(!terminal, `capacity task ended unsuccessfully: ${terminal?.data?.errorCode || terminal?.code || terminal?.type || 'unknown'}`);
      }
      return tracks.every((track) =>
        track.messages.filter((event) =>
          event.conversationId === track.conversation.id && event.type === 'job.completed'
        ).length === round + 1
      );
    });
    roundMilliseconds.push(Date.now() - startedAt);

    for (const track of tracks) {
      const completed = track.messages.filter((event) =>
        event.conversationId === track.conversation.id && event.type === 'job.completed'
      ).at(-1);
      const answer = track.messages.filter((event) =>
        event.jobId === completed.jobId && event.type === 'message.delta'
      ).map((event) => event.data.text).join('');
      assert.ok(answer.includes(track.marker), `round ${round + 1}: context marker lost`);
      for (const other of tracks) {
        if (other !== track) assert.equal(answer.includes(other.marker), false, 'cross-conversation context leak');
      }
    }
  }

  for (const member of members) {
    const conversations = await expectJsonStatus(fetch(`${origin}/api/conversations`, {
      headers: authHeaders(member)
    }), 200, 'conversation listing');
    assert.equal(conversations.conversations.length, profile.conversationsPerUser);
    const other = tracks.find((track) => track.member.user.id !== member.user.id);
    const denied = await fetch(`${origin}/api/conversations/${other.conversation.id}`, {
      headers: authHeaders(member)
    });
    assert.equal(denied.status, 404);
    await denied.body?.cancel().catch(() => {});
  }

  assert.equal(maxRunning, profile.executionSlots);
  assert.equal(maxUserRunning, profile.userRunning);
  assert.ok(maxQueued > 0);
  await workbench.stop();
  stopped = true;
  t.diagnostic(JSON.stringify({
    schemaVersion: 1,
    mode: 'production-mysql-real-opencode',
    users: profile.users,
    webSockets: profile.connections,
    conversations: profile.conversations,
    rounds: profile.rounds,
    completed: profile.tasks,
    workerCount: profile.workerCount,
    workerCapacity: profile.workerCapacity,
    maxRunning,
    maxUserRunning,
    maxQueued,
    roundMilliseconds
  }));
});
