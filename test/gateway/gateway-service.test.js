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
  failSessionForWorker = null,
  writeArtifacts = false,
  emptyResponse = false,
  validationDiscovery = true,
  validationMarkerMatches = true,
  validationToolResult = null,
  validationGate = null
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
  const promptRequests = [];
  const abortRequests = [];
  const validationRequests = [];
  const pool = createWorkerPool({
    workerCount: 2,
    heartbeatMs: 60_000,
    workerFactory: ({ id, index, onExit }) => {
      const record = { id, index, status: 'stopped', onExit, sessions: 0, sessionsAvailable: true };
      records.push(record);
      const client = {
        async requestJson(pathname, { directory } = {}) {
          if (pathname !== '/skill') throw new Error(`unexpected request: ${pathname}`);
          const root = path.join(directory, '.opencode', 'skills');
          if (!validationDiscovery || !fs.existsSync(root)) return [];
          return fs.readdirSync(root, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => ({ name: entry.name }));
        },
        async getSession({ sessionId }) {
          if (!record.sessionsAvailable) throw Object.assign(new Error('session missing'), { code: 'OPENCODE_API_ERROR' });
          return { id: sessionId };
        },
        async createSession({ directory }) {
          if (failSessionForWorker === id) {
            const error = new Error('session failed');
            error.code = 'OPENCODE_API_ERROR';
            throw error;
          }
          record.sessions += 1;
          return { id: `${id}-session-${record.sessions}`, directory };
        },
        async prompt({ text, directory, agent, tools, signal }) {
          promptRequests.push({ text, directory, agent, tools });
          if (text.startsWith('OpenCode Skill validation marker:')) {
            const marker = text.split('\n', 1)[0].slice('OpenCode Skill validation marker:'.length).trim();
            const skillRoot = path.join(directory, '.opencode', 'skills');
            const [slug] = fs.readdirSync(skillRoot);
            validationRequests.push({
              marker,
              slug,
              skillMd: fs.readFileSync(path.join(skillRoot, slug, 'SKILL.md'), 'utf8'),
              guide: fs.readFileSync(path.join(skillRoot, slug, 'references', 'guide.md'), 'utf8'),
              directory,
              agent,
              tools,
              directoryMode: fs.statSync(directory).mode & 0o777,
              skillMode: fs.statSync(path.join(skillRoot, slug, 'SKILL.md')).mode & 0o777
            });
            if (validationGate) {
              const onAbort = () => {
                const error = new Error('validation aborted');
                error.code = 'OPENCODE_ABORTED';
                validationGate.reject(error);
              };
              signal?.addEventListener('abort', onAbort, { once: true });
              try {
                await validationGate.promise;
              } finally {
                signal?.removeEventListener('abort', onAbort);
              }
            }
            if (validationToolResult) {
              return {
                parts: [{
                  type: 'tool',
                  tool: 'skill',
                  state: {
                    status: validationToolResult.status,
                    input: { name: validationToolResult.name || slug },
                    output: validationToolResult.output || '',
                    error: validationToolResult.error || null
                  }
                }]
              };
            }
            return {
              parts: [{ type: 'text', text: validationMarkerMatches ? marker : 'VALIDATION_FAILED' }]
            };
          }
          const [userId] = text.split(':');
          running += 1;
          maxRunning = Math.max(maxRunning, running);
          const userRunning = (runningByUser.get(userId) || 0) + 1;
          runningByUser.set(userId, userRunning);
          maxPerUser = Math.max(maxPerUser, userRunning);
          starts.push(text);
          const gate = deferred();
          pending.set(text, gate);
          if (automatic) setImmediate(() => {
            if (writeArtifacts) fs.writeFileSync(path.join(directory, 'artifact.txt'), text);
            gate.resolve(`answer:${text}`);
          });
          const onAbort = () => {
            const error = new Error('aborted');
            error.code = 'OPENCODE_ABORTED';
            gate.reject(error);
          };
          signal?.addEventListener('abort', onAbort, { once: true });
          try {
            const answer = await gate.promise;
            if (emptyResponse) return { parts: [] };
            return { parts: [{ type: 'text', text: answer }] };
          } finally {
            signal?.removeEventListener('abort', onAbort);
            pending.delete(text);
            running -= 1;
            runningByUser.set(userId, runningByUser.get(userId) - 1);
          }
        },
        async abortSession(request) {
          abortRequests.push(request);
          return true;
        }
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
      record.crash = ({ loseSessions = false } = {}) => {
        if (loseSessions) record.sessionsAvailable = false;
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
    promptRequests,
    abortRequests,
    validationRequests,
    workspaceRoot,
    conversation,
    submit,
    metrics: () => ({ maxRunning, maxPerUser })
  };
}

test('validates a Skill through the shared OpenCode worker pool in a disposable restricted workspace', async (t) => {
  const fixture = createFixture(t, { automatic: true });
  await fixture.service.start();

  const result = await fixture.service.validateSkillPackage({
    skillId: 'skill-validation',
    versionId: 'version-validation',
    ownerUserId: 'user-1',
    slug: 'gpu-planner',
    skillMd: '---\nname: gpu-planner\ndescription: Plan safely\n---\n# Instructions',
    files: [{ path: 'references/guide.md', content: '# Guide' }],
    contentSha256: 'a'.repeat(64)
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.provider, 'opencode-gateway');
  assert.equal(result.evidence, 'exact-marker');
  assert.equal(Number.isInteger(result.durationMs), true);
  assert.equal(fixture.validationRequests.length, 1);
  const request = fixture.validationRequests[0];
  assert.equal(request.slug, 'gpu-planner');
  assert.match(request.skillMd, /name: gpu-planner/);
  assert.equal(request.guide, '# Guide');
  assert.equal(request.directoryMode, 0o700);
  assert.equal(request.skillMode, 0o600);
  assert.equal(request.agent, 'build');
  assert.deepEqual(request.tools, {
    bash: false,
    task: false,
    webfetch: false,
    websearch: false
  });
  assert.equal(fs.existsSync(request.directory), false);
});

test('fails closed when OpenCode cannot discover the Skill or return the exact validation marker', async (t) => {
  const missing = createFixture(t, { automatic: true, validationDiscovery: false });
  await missing.service.start();
  const input = {
    skillId: 'skill-validation',
    versionId: 'version-validation',
    ownerUserId: 'user-1',
    slug: 'gpu-planner',
    skillMd: '---\nname: gpu-planner\ndescription: Plan safely\n---\n# Instructions',
    files: [{ path: 'references/guide.md', content: '# Guide' }],
    contentSha256: 'a'.repeat(64)
  };
  await assert.rejects(
    missing.service.validateSkillPackage(input),
    (error) => error.code === 'SKILL_RUNTIME_DISCOVERY_FAILED'
  );

  const mismatch = createFixture(t, { automatic: true, validationMarkerMatches: false });
  await mismatch.service.start();
  await assert.rejects(
    mismatch.service.validateSkillPackage(input),
    (error) => error.code === 'SKILL_RUNTIME_RESPONSE_INVALID'
  );
});

test('accepts OpenCode native evidence that the exact Skill tool completed with output', async (t) => {
  const fixture = createFixture(t, {
    automatic: true,
    validationToolResult: {
      status: 'completed',
      name: 'gpu-planner',
      output: 'loaded private Skill instructions'
    }
  });
  await fixture.service.start();

  const result = await fixture.service.validateSkillPackage({
    skillId: 'skill-validation',
    versionId: 'version-validation',
    ownerUserId: 'user-1',
    slug: 'gpu-planner',
    skillMd: '---\nname: gpu-planner\ndescription: Plan safely\n---\n# Instructions',
    files: [{ path: 'references/guide.md', content: '# Guide' }],
    contentSha256: 'a'.repeat(64)
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.provider, 'opencode-gateway');
  assert.equal(result.evidence, 'skill-tool-completed');
});

test('rejects Skill tool evidence for the wrong Skill, failed tool, or empty output', async (t) => {
  const input = {
    skillId: 'skill-validation',
    versionId: 'version-validation',
    ownerUserId: 'user-1',
    slug: 'gpu-planner',
    skillMd: '---\nname: gpu-planner\ndescription: Plan safely\n---\n# Instructions',
    files: [{ path: 'references/guide.md', content: '# Guide' }],
    contentSha256: 'a'.repeat(64)
  };
  for (const validationToolResult of [
    { status: 'completed', name: 'other-skill', output: 'loaded' },
    { status: 'error', name: 'gpu-planner', output: '', error: 'load failed' },
    { status: 'completed', name: 'gpu-planner', output: '' }
  ]) {
    const fixture = createFixture(t, { automatic: true, validationToolResult });
    await fixture.service.start();
    await assert.rejects(
      fixture.service.validateSkillPackage(input),
      (error) => error.code === 'SKILL_RUNTIME_RESPONSE_INVALID'
    );
  }
});

test('keeps Skill validation behind business jobs and includes it in waitForIdle', async (t) => {
  const validationGate = deferred();
  const fixture = createFixture(t, { validationGate });
  await fixture.service.start();
  const firstConversation = fixture.conversation(1, 'priority-first');
  const secondConversation = fixture.conversation(2, 'priority-second');
  fixture.submit(firstConversation, 1, 'priority-first');
  await eventually(() => fixture.pending.has('user-1:priority-first'));

  const validation = fixture.service.validateSkillPackage({
    skillId: 'skill-validation',
    versionId: 'version-validation',
    ownerUserId: 'user-3',
    slug: 'gpu-planner',
    skillMd: '---\nname: gpu-planner\ndescription: Plan safely\n---\n# Instructions',
    files: [{ path: 'references/guide.md', content: '# Guide' }],
    contentSha256: 'a'.repeat(64)
  });
  fixture.submit(secondConversation, 2, 'priority-second');
  await eventually(() => fixture.pending.has('user-2:priority-second'));
  assert.equal(fixture.validationRequests.length, 0);

  fixture.pending.get('user-1:priority-first').resolve('answer:first');
  fixture.pending.get('user-2:priority-second').resolve('answer:second');
  await eventually(() => fixture.validationRequests.length === 1);
  let idleResolved = false;
  const idle = fixture.service.waitForIdle().then(() => { idleResolved = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(idleResolved, false);

  validationGate.resolve();
  await validation;
  await idle;
  assert.equal(idleResolved, true);
});

test('aborts an active Skill validation during clean Gateway shutdown', async (t) => {
  const validationGate = deferred();
  const fixture = createFixture(t, { validationGate });
  await fixture.service.start();
  const validation = fixture.service.validateSkillPackage({
    skillId: 'skill-validation',
    versionId: 'version-validation',
    ownerUserId: 'user-1',
    slug: 'gpu-planner',
    skillMd: '---\nname: gpu-planner\ndescription: Plan safely\n---\n# Instructions',
    files: [{ path: 'references/guide.md', content: '# Guide' }],
    contentSha256: 'a'.repeat(64)
  });
  await eventually(() => fixture.validationRequests.length === 1);

  const stopped = await fixture.service.stop();
  assert.equal(stopped.status, 'stopped');
  await assert.rejects(validation, (error) => error.code === 'OPENCODE_ABORTED');
});

test('derives private workspace directories and applies the restricted prompt tool profile', async (t) => {
  const fixture = createFixture(t, { automatic: true, writeArtifacts: true });
  await fixture.service.start();
  const first = fixture.conversation(1, 'first');
  const second = fixture.conversation(1, 'second');
  const otherUser = fixture.conversation(2, 'first');
  const widened = path.join(fixture.workspaceRoot, 'user-1', first.id);
  fs.mkdirSync(widened, { recursive: true });
  fs.chmodSync(widened, 0o777);

  fixture.submit(first, 1, 'workspace-first');
  fixture.submit(second, 1, 'workspace-second');
  fixture.submit(otherUser, 2, 'workspace-other-user');
  await fixture.service.waitForIdle();

  assert.equal(fixture.promptRequests.length, 3);
  const directories = new Set(fixture.promptRequests.map((request) => request.directory));
  assert.equal(directories.size, 3);
  for (const request of fixture.promptRequests) {
    assert.deepEqual(request.tools, {
      bash: false,
      task: false,
      webfetch: false,
      websearch: false
    });
    assert.equal(request.agent, 'build');
    assert.equal(fs.statSync(request.directory).mode & 0o777, 0o700);
    const artifact = path.join(request.directory, 'artifact.txt');
    assert.equal(fs.readFileSync(artifact, 'utf8'), request.text);
    assert.equal(fs.statSync(artifact).mode & 0o777, 0o600);
  }
});

test('fails a job before OpenCode when a user workspace symlink escapes the root', async (t) => {
  const fixture = createFixture(t, { automatic: true, writeArtifacts: true });
  await fixture.service.start();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-workspace-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.symlinkSync(outside, path.join(fixture.workspaceRoot, 'user-1'));
  const conversation = fixture.conversation(1, 'symlink');

  const job = fixture.submit(conversation, 1, 'symlink-escape');
  await fixture.service.waitForIdle();

  assert.equal(fixture.store.getJob({ id: job.id }).status, 'failed');
  assert.equal(fixture.promptRequests.length, 0);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('rejects a symlink planted inside a conversation workspace before tool execution', async (t) => {
  const fixture = createFixture(t, { automatic: true, writeArtifacts: true });
  await fixture.service.start();
  const conversation = fixture.conversation(1, 'inner-symlink');
  const directory = path.join(fixture.workspaceRoot, 'user-1', conversation.id);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-artifact-outside-'));
  const secret = path.join(outside, 'secret.txt');
  fs.writeFileSync(secret, 'must-not-be-read');
  fs.mkdirSync(directory, { recursive: true });
  fs.symlinkSync(secret, path.join(directory, 'linked-secret.txt'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));

  const job = fixture.submit(conversation, 1, 'inner-symlink');
  await fixture.service.waitForIdle();

  assert.equal(fixture.store.getJob({ id: job.id }).status, 'failed');
  assert.equal(fixture.promptRequests.length, 0);
  assert.equal(fs.readFileSync(secret, 'utf8'), 'must-not-be-read');
});

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
    'message.created', 'job.queued',
    'job.started',
    'message.delta',
    'job.completed'
  ]);
  assert.equal(events[3].data.text, 'answer:user-1:same');
  assert.equal(fixture.records.reduce((sum, record) => sum + record.sessions, 0), 1);
});

test('replays persisted events and streams later events without cross-conversation leakage', async (t) => {
  const fixture = createFixture(t, { automatic: true });
  await fixture.service.start();
  const conversation = fixture.conversation(1);
  const sibling = fixture.conversation(2);
  const received = [];
  const unsubscribe = fixture.service.subscribe({
    conversationId: conversation.id,
    userId: 'user-1',
    afterSequence: 0,
    onEvent: (event) => received.push(event)
  });

  fixture.submit(sibling, 2, 'sibling');
  fixture.submit(conversation, 1, 'live');
  await fixture.service.waitForIdle();
  unsubscribe();

  assert.equal(received[0].type, 'conversation.snapshot');
  assert.deepEqual(received.slice(1).map((event) => event.type), [
    'message.created', 'job.queued', 'job.started', 'message.delta', 'job.completed'
  ]);
  assert.equal(received.every((event) => event.conversationId === conversation.id), true);
  const reconnected = [];
  fixture.service.subscribe({
    conversationId: conversation.id,
    userId: 'user-1',
    afterSequence: received.at(-2).sequence,
    onEvent: (event) => reconnected.push(event)
  })();
  assert.deepEqual(reconnected.map((event) => event.type), ['job.completed']);
});

test('returns a recovery boundary instead of truncating an oversized event backlog', async (t) => {
  const fixture = createFixture(t, { automatic: true });
  await fixture.service.start();
  const conversation = fixture.conversation(1);
  let latest;
  for (let index = 0; index < 1001; index += 1) {
    latest = fixture.store.appendEvent({
      conversationId: conversation.id,
      type: 'message.delta',
      payload: { text: `chunk-${index}` }
    });
  }
  const received = [];

  fixture.service.subscribe({
    conversationId: conversation.id,
    userId: 'user-1',
    afterSequence: 0,
    onEvent: (event) => received.push(event)
  });

  assert.equal(received.length, 1);
  assert.equal(received[0].type, 'conversation.snapshot');
  assert.equal(received[0].sequence, latest.sequence);
  assert.equal(received[0].data.recoveryBoundary, true);
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

test('fails an empty OpenCode response instead of marking a blank answer completed', async (t) => {
  const fixture = createFixture(t, { automatic: true, emptyResponse: true });
  await fixture.service.start();
  const conversation = fixture.conversation(1, 'empty-response');

  const job = fixture.submit(conversation, 1, 'empty-response');
  await fixture.service.waitForIdle();

  const stored = fixture.store.getJob({ id: job.id });
  assert.equal(stored.status, 'failed');
  assert.equal(stored.errorCode, 'OPENCODE_EMPTY_RESPONSE');
});

test('a recovered worker wakes sticky queued conversations without new user input', async (t) => {
  const fixture = createFixture(t, { automatic: true });
  await fixture.service.start();
  const conversation = fixture.conversation(1);
  fixture.submit(conversation, 1, 'first');
  await fixture.service.waitForIdle();
  const binding = fixture.store.getOpenCodeSession({ conversationId: conversation.id });
  fixture.records.find((record) => record.id === binding.workerId).crash();
  const queued = fixture.submit(conversation, 1, 'after-recovery');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.store.getJob({ id: queued.id }).status, 'queued');
  await fixture.pool.heartbeat();
  await eventually(() => fixture.store.getJob({ id: queued.id }).status === 'completed');
});

test('runtime restart validates persisted sessions before resuming queued work', async (t) => {
  const fixture = createFixture(t, { automatic: true });
  await fixture.service.start();
  const conversation = fixture.conversation(1);
  fixture.submit(conversation, 1, 'first');
  await fixture.service.waitForIdle();
  const original = fixture.store.getOpenCodeSession({ conversationId: conversation.id });
  fixture.records.find((record) => record.id === original.workerId).crash();
  assert.equal(fixture.store.getOpenCodeSession({ conversationId: conversation.id }).recoveryStatus, 'recovering');
  const queued = fixture.submit(conversation, 1, 'after-restart');
  await fixture.pool.heartbeat();
  await eventually(() => fixture.store.getJob({ id: queued.id }).status === 'completed');
  const restored = fixture.store.getOpenCodeSession({ conversationId: conversation.id });
  assert.equal(restored.opencodeSessionId, original.opencodeSessionId);
  assert.equal(restored.recoveryStatus, 'active');
});

test('runtime restart interrupts queued work when its previous session disappeared', async (t) => {
  const fixture = createFixture(t, { automatic: true });
  await fixture.service.start();
  const conversation = fixture.conversation(1);
  fixture.submit(conversation, 1, 'first');
  await fixture.service.waitForIdle();
  const binding = fixture.store.getOpenCodeSession({ conversationId: conversation.id });
  fixture.records.find((record) => record.id === binding.workerId).crash({ loseSessions: true });
  const queued = fixture.submit(conversation, 1, 'must-not-run');
  await fixture.pool.heartbeat();
  await eventually(() => fixture.store.getJob({ id: queued.id }).status === 'interrupted');
  assert.equal(fixture.store.getJob({ id: queued.id }).errorCode, 'OPENCODE_SESSION_UNAVAILABLE');
  assert.equal(fixture.starts.includes('user-1:must-not-run'), false);
  assert.equal(fixture.store.getOpenCodeSession({ conversationId: conversation.id }).recoveryStatus, 'unavailable');
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

  const abortsBeforeTimeout = fixture.abortRequests.length;
  const timeoutConversation = fixture.conversation(2);
  const timedOut = fixture.submit(timeoutConversation, 2, 'timeout');
  await fixture.service.waitForIdle();
  assert.equal(fixture.store.getJob({ id: timedOut.id }).status, 'timed_out');
  assert.equal(fixture.store.getJob({ id: timedOut.id }).errorCode, 'GATEWAY_JOB_TIMEOUT');
  assert.equal(fixture.abortRequests.length, abortsBeforeTimeout + 1);
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

test('classifies runtime connection loss as interrupted before the worker exit event arrives', async (t) => {
  const fixture = createFixture(t);
  await fixture.service.start();
  const conversation = fixture.conversation(1, 'connection-loss');
  const followUpConversation = fixture.conversation(1, 'after-connection-loss');
  const job = fixture.submit(conversation, 1, 'connection-loss');
  const followUp = fixture.submit(followUpConversation, 1, 'after-connection-loss');
  await eventually(() => fixture.pending.has('user-1:connection-loss'));

  const error = new Error('runtime connection closed');
  error.code = 'OPENCODE_UNAVAILABLE';
  fixture.pending.get('user-1:connection-loss').reject(error);
  await eventually(() => fixture.store.getJob({ id: job.id }).status === 'interrupted');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(fixture.store.getJob({ id: job.id }).status, 'interrupted');
  assert.equal(fixture.store.getJob({ id: job.id }).errorCode, 'OPENCODE_UNAVAILABLE');
  assert.equal(fixture.pool.snapshot().workers.some((worker) => worker.status === 'unhealthy'), true);
  assert.equal(fixture.store.getJob({ id: followUp.id }).status, 'queued');
  assert.equal(fixture.pending.has('user-1:after-connection-loss'), false);
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
