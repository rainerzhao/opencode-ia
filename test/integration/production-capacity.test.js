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
const { loadProductionDrProfile } = require('../../src/gateway/production-dr-profile');
const { loadProductionSoakProfile } = require('../../src/gateway/production-soak-profile');
const { validateProductionConfig } = require('../../scripts/check-production-config');
const { validateOpenCodeProviderConfig } = require('../../scripts/check-opencode-provider');
const { authHeaders, login, readJson } = require('../fixtures/authenticated-workbench');
const { runAdminCli } = require('../fixtures/admin-cli');
const { runProductionDrAcceptance } = require('../fixtures/production-dr-acceptance');
const { createProductionSoakSchedule } = require('../fixtures/production-soak');

const enabled = process.env.WORKBENCH_PRODUCTION_CAPACITY_ACCEPTANCE === '1';
const recoveryEnabled = process.env.WORKBENCH_PRODUCTION_RECOVERY_ACCEPTANCE === '1';
const soakEnabled = process.env.WORKBENCH_PRODUCTION_SOAK_ACCEPTANCE === '1';
const drEnabled = process.env.WORKBENCH_PRODUCTION_DR_ACCEPTANCE === '1';

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

function answerFor(messages, jobId) {
  return messages
    .filter((event) => event.jobId === jobId && event.type === 'message.delta')
    .map((event) => event.data.text)
    .join('');
}

async function sampleServiceHealth({ origin, admin }) {
  const [service, gateway] = await Promise.all([
    expectJsonStatus(fetch(`${origin}/healthz`), 200, 'soak service health sample'),
    expectJsonStatus(fetch(`${origin}/api/admin/gateway/health`, {
      headers: authHeaders(admin)
    }), 200, 'soak gateway health sample')
  ]);
  assert.equal(service.status, 'healthy', 'workbench health degraded during soak');
  assert.equal(gateway.status, 'healthy', 'gateway health degraded during soak');
}

async function waitForScheduledCycle({ deadline, sample }) {
  let samples = 0;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, deadline - Date.now())));
    await sample();
    samples += 1;
  }
  return samples;
}

test('twenty users complete isolated multi-round work through MySQL production and real OpenCode', {
  skip: !enabled,
  timeout: soakEnabled ? 100_800_000 : 3_600_000
}, async (t) => {
  const profile = loadProductionCapacityProfile();
  const soakProfile = soakEnabled ? loadProductionSoakProfile() : null;
  const drProfile = drEnabled ? loadProductionDrProfile() : null;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'production-capacity-'));
  const workerBasePort = await reservePortBlock(profile.workerCount);
  const adminPassword = `Capacity Admin ${crypto.randomBytes(16).toString('hex')}!`;
  const memberPassword = `Capacity Member ${crypto.randomBytes(16).toString('hex')}!`;
  const runMarker = crypto.randomBytes(6).toString('hex');
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    WORKBENCH_DATA_DIR: path.join(root, 'data'),
    CONTENT_ATTACHMENT_ROOT: path.join(root, 'data', 'content-attachments'),
    OPENCODE_CWD: path.join(root, 'runtime'),
    OPENCODE_WORKER_BASE_PORT: String(workerBasePort),
    XDG_DATA_HOME: path.join(root, 'opencode-data'),
    XDG_CACHE_HOME: path.join(root, 'opencode-cache'),
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

  let workbench = await createMySqlProductionWorkbench({
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

  let recovery = null;
  if (recoveryEnabled) {
    const track = tracks[0];
    const capacityJobIds = track.messages
      .filter((event) => event.type === 'job.accepted' && event.conversationId === track.conversation.id)
      .map((event) => event.jobId);
    assert.equal(capacityJobIds.length, profile.rounds, 'capacity job ids are incomplete before recovery drill');

    track.socket.send(JSON.stringify({
      type: 'prompt',
      conversationId: track.conversation.id,
      idempotencyKey: `${track.conversation.id}-recovery-crash`,
      text: '继续分析当前会话，但先进行充分思考，稍后再回答。不要使用工具。'
    }));
    const crashAccepted = await until(() => track.messages.find((event) =>
      event.type === 'job.accepted'
      && event.conversationId === track.conversation.id
      && !capacityJobIds.includes(event.jobId)
    ));
    await until(() => track.messages.find((event) =>
      event.type === 'job.started' && event.jobId === crashAccepted.jobId
    ));

    const jobsAtCrash = await expectJsonStatus(fetch(`${origin}/api/admin/gateway/jobs`, {
      headers: authHeaders(admin)
    }), 200, 'recovery job metadata');
    const runningJob = jobsAtCrash.jobs.find((job) => job.id === crashAccepted.jobId);
    assert.equal(runningJob?.status, 'running', 'recovery crash job was not running');
    assert.ok(runningJob.workerId, 'recovery crash job has no worker binding');
    const originalWorker = workbench.gatewayService.snapshot().pool.workers.find((worker) =>
      worker.id === runningJob.workerId
    );
    assert.equal(originalWorker?.status, 'healthy', 'recovery crash worker was not healthy');
    assert.ok(Number.isInteger(originalWorker.processId) && originalWorker.processId > 1, 'recovery crash worker has no process');

    track.socket.send(JSON.stringify({
      type: 'prompt',
      conversationId: track.conversation.id,
      idempotencyKey: `${track.conversation.id}-recovery-queued`,
      text: `只原样输出本会话第一轮唯一标识 ${track.marker}，不要使用工具。`
    }));
    const queuedAccepted = await until(() => track.messages.find((event) =>
      event.type === 'job.accepted'
      && event.conversationId === track.conversation.id
      && ![...capacityJobIds, crashAccepted.jobId].includes(event.jobId)
    ));
    await until(() => track.messages.find((event) =>
      event.type === 'job.queued' && event.jobId === queuedAccepted.jobId
    ));

    try {
      process.kill(originalWorker.processId, 'SIGKILL');
    } catch {
      assert.fail('recovery crash signal could not be delivered');
    }
    await until(() => track.messages.find((event) =>
      event.type === 'job.interrupted' && event.jobId === crashAccepted.jobId
    ));
    const restartedWorker = await until(() => {
      const worker = workbench.gatewayService.snapshot().pool.workers.find((item) => item.id === originalWorker.id);
      return worker?.status === 'healthy'
        && Number.isInteger(worker.processId)
        && worker.processId !== originalWorker.processId
        ? worker
        : null;
    });
    assert.equal(
      restartedWorker.processId !== originalWorker.processId,
      true,
      'recovery worker process was not replaced'
    );

    const queuedTerminal = await until(() => track.messages.find((event) =>
      event.jobId === queuedAccepted.jobId
      && ['job.completed', 'job.interrupted', 'job.failed'].includes(event.type)
    ));
    let recoveryMode;
    if (queuedTerminal.type === 'job.completed') {
      assert.ok(answerFor(track.messages, queuedAccepted.jobId).includes(track.marker), 'recovered session lost its marker');
      recoveryMode = 'session-restored';
    } else {
      assert.equal(queuedTerminal.type, 'job.interrupted', 'queued recovery job failed instead of reaching a safe boundary');
      assert.ok(track.messages.some((event) =>
        event.type === 'conversation.recovery_boundary' && event.conversationId === track.conversation.id
      ), 'unavailable session did not publish a recovery boundary');
      recoveryMode = 'safe-recovery-boundary';
    }

    const acceptedJobIds = [...capacityJobIds, crashAccepted.jobId, queuedAccepted.jobId];
    assert.equal(new Set(acceptedJobIds).size, 5, 'recovery drill did not produce five distinct jobs');
    recovery = {
      conversationId: track.conversation.id,
      username: track.member.user.username,
      acceptedJobIds,
      mode: recoveryMode,
      processReplaced: true
    };
  }

  await workbench.stop();
  stopped = true;
  for (const socket of sockets) socket.terminate();

  let soak = null;
  let disasterRecovery = null;
  if (recovery) {
    workbench = await createMySqlProductionWorkbench({
      env,
      projectDir: path.resolve(__dirname, '../..'),
      logger: { log() {}, error() {} }
    });
    stopped = false;
    const restartedAddress = await workbench.start(0, '127.0.0.1');
    const restartedOrigin = `http://127.0.0.1:${restartedAddress.port}`;
    const restartedAdmin = await login(restartedOrigin, 'capacity.admin', adminPassword);
    assert.equal(restartedAdmin.response.status, 200, 'administrator login after workbench restart failed');
    const restartedMember = await login(restartedOrigin, recovery.username, memberPassword);
    assert.equal(restartedMember.response.status, 200, 'member login after workbench restart failed');
    const persistedConversation = await expectJsonStatus(fetch(
      `${restartedOrigin}/api/conversations/${recovery.conversationId}`,
      { headers: authHeaders(restartedMember) }
    ), 200, 'persisted conversation read');
    assert.equal(persistedConversation.conversation.id, recovery.conversationId);
    const history = await expectJsonStatus(fetch(
      `${restartedOrigin}/api/conversations/${recovery.conversationId}/events?afterSequence=0&limit=1000`,
      { headers: authHeaders(restartedMember) }
    ), 200, 'persisted conversation history read');
    assert.equal(history.hasMore, false, 'recovery acceptance history exceeded its bounded read');
    const terminalTypes = new Set(['job.completed', 'job.interrupted', 'job.failed']);
    for (const jobId of recovery.acceptedJobIds) {
      const terminals = history.events.filter((event) => event.jobId === jobId && terminalTypes.has(event.type));
      assert.equal(terminals.length, 1, `job ${jobId} does not have exactly one persisted terminal event`);
    }

    if (soakProfile) {
      const schedule = createProductionSoakSchedule({
        users: soakProfile.users,
        cohortSize: soakProfile.cohortSize,
        durationMs: soakProfile.durationMs,
        intervalMs: soakProfile.intervalMs
      });
      assert.equal(schedule.length, soakProfile.cycles);
      const soakTracks = [];
      for (const [userIndex, member] of members.entries()) {
        const session = await login(restartedOrigin, member.user.username, memberPassword);
        assert.equal(session.response.status, 200, `soak member ${userIndex + 1} login failed`);
        const body = await expectJsonStatus(fetch(`${restartedOrigin}/api/conversations`, {
          method: 'POST',
          headers: authHeaders(session, { json: true }),
          body: JSON.stringify({ title: `长稳验收 ${runMarker}-${userIndex}` })
        }), 201, 'soak conversation creation');
        const socket = new WebSocket(restartedOrigin.replace('http:', 'ws:'), {
          headers: { cookie: session.cookie }
        });
        sockets.push(socket);
        const messages = [];
        socket.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
        socket.on('error', () => {});
        await until(() => messages.some((message) => message.type === 'connected'));
        socket.send(JSON.stringify({
          type: 'subscribe',
          conversationId: body.conversation.id,
          afterSequence: 0
        }));
        await until(() => messages.some((message) =>
          message.type === 'conversation.snapshot' && message.conversationId === body.conversation.id
        ));
        soakTracks.push({
          socket,
          messages,
          conversation: body.conversation,
          marker: `SOAK_${runMarker}_${userIndex}`,
          turns: 0
        });
      }

      const soakStartedAt = Date.now();
      let completed = 0;
      let healthSamples = 0;
      let maxCycleMilliseconds = 0;
      for (const [cycleIndex, cycle] of schedule.entries()) {
        healthSamples += await waitForScheduledCycle({
          deadline: soakStartedAt + cycle.offsetMs,
          sample: () => sampleServiceHealth({ origin: restartedOrigin, admin: restartedAdmin })
        });
        const cycleStartedAt = Date.now();
        const cohort = cycle.userIndexes.map((userIndex) => soakTracks[userIndex]);
        const accepted = [];
        for (const track of cohort) {
          const acceptedBefore = track.messages.filter((event) => event.type === 'job.accepted').length;
          const text = track.turns === 0
            ? `记住唯一标识 ${track.marker}，只原样输出该标识。不要使用工具。`
            : `只原样输出本会话第一轮唯一标识，再写“长稳第 ${track.turns + 1} 次”。不要使用工具。`;
          track.socket.send(JSON.stringify({
            type: 'prompt',
            conversationId: track.conversation.id,
            idempotencyKey: `${track.conversation.id}-soak-${track.turns}`,
            text
          }));
          accepted.push(await until(() => {
            const events = track.messages.filter((event) => event.type === 'job.accepted');
            return events.length > acceptedBefore ? events.at(-1) : null;
          }));
        }

        await until(() => cohort.every((track, cohortIndex) => {
          const terminal = track.messages.find((event) =>
            event.jobId === accepted[cohortIndex].jobId
            && ['job.completed', 'job.failed', 'job.interrupted', 'job.timed_out'].includes(event.type)
          );
          if (terminal && terminal.type !== 'job.completed') {
            assert.fail(`production soak task ended as ${terminal.type}`);
          }
          return terminal?.type === 'job.completed';
        }));

        for (const [cohortIndex, track] of cohort.entries()) {
          const answer = answerFor(track.messages, accepted[cohortIndex].jobId);
          assert.ok(answer.includes(track.marker), `soak cycle ${cycleIndex + 1}: context marker lost`);
          for (const other of soakTracks) {
            if (other !== track) assert.equal(answer.includes(other.marker), false, 'soak cross-conversation context leak');
          }
          track.turns += 1;
        }
        completed += cohort.length;
        maxCycleMilliseconds = Math.max(maxCycleMilliseconds, Date.now() - cycleStartedAt);
        await sampleServiceHealth({ origin: restartedOrigin, admin: restartedAdmin });
        healthSamples += 1;
      }
      healthSamples += await waitForScheduledCycle({
        deadline: soakStartedAt + soakProfile.durationMs,
        sample: () => sampleServiceHealth({ origin: restartedOrigin, admin: restartedAdmin })
      });
      assert.equal(soakTracks.every((track) => track.turns > 0), true, 'soak did not cover every member');
      soak = {
        durationMinutes: soakProfile.durationMinutes,
        intervalSeconds: soakProfile.intervalSeconds,
        cycles: schedule.length,
        completed,
        healthSamples,
        maxCycleMilliseconds
      };
    }

    await workbench.stop();
    stopped = true;

    if (drProfile) {
      disasterRecovery = await runProductionDrAcceptance({
        env,
        root,
        recovery,
        memberPassword,
        projectDir: path.resolve(__dirname, '../..'),
        logger: { log() {}, error() {} }
      });
    }
  }

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
    roundMilliseconds,
    recovery: recovery ? {
      enabled: true,
      mode: recovery.mode,
      processReplaced: recovery.processReplaced,
      persistedJobs: recovery.acceptedJobIds.length
    } : { enabled: false },
    soak: soak ? {
      enabled: true,
      durationMinutes: soak.durationMinutes,
      intervalSeconds: soak.intervalSeconds,
      cycles: soak.cycles,
      completed: soak.completed,
      healthSamples: soak.healthSamples,
      maxCycleMilliseconds: soak.maxCycleMilliseconds
    } : { enabled: false },
    disasterRecovery: disasterRecovery ? {
      enabled: true,
      databaseRestored: disasterRecovery.databaseRestored,
      attachmentRestored: disasterRecovery.attachmentRestored,
      persistedJobs: disasterRecovery.persistedJobs
    } : { enabled: false }
  }));
});
