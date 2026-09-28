'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runProductionDrAcceptance } = require('../fixtures/production-dr-acceptance');

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'production-dr-acceptance-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const attachmentRoot = path.join(root, 'custom-attachments');
  const env = {
    WORKBENCH_DATA_DIR: path.join(root, 'source-data'),
    CONTENT_ATTACHMENT_ROOT: attachmentRoot,
    WORKBENCH_DATABASE_URL: 'mysqls://source:secret@source.example/opencode_acceptance',
    WORKBENCH_RECOVERY_DATABASE_URL: 'mysqls://target:secret@target.example/opencode_recovery_acceptance'
  };
  const recovery = {
    conversationId: 'conversation-1',
    username: 'member-1',
    acceptedJobIds: ['job-1', 'job-2', 'job-3', 'job-4', 'job-5']
  };
  return { root, attachmentRoot, env, recovery };
}

function createHappyDependencies(events, terminalCount = 5) {
  let canary;
  return {
    backupMySql(argv, { env }) {
      events.push(['backup', argv, env.WORKBENCH_DATABASE_URL]);
      const attachmentIndex = argv.indexOf('--attachments');
      canary = fs.readFileSync(path.join(argv[attachmentIndex + 1], 'acceptance', 'dr-canary.bin'));
    },
    async createMySqlDatabase() {
      return {
        async assertCapabilities() { events.push(['capabilities']); },
        async one() { events.push(['empty-check']); return { count: 0 }; },
        async close() { events.push(['database-close']); }
      };
    },
    restoreMySql(argv, { env }) {
      events.push(['restore', argv, env.WORKBENCH_DATABASE_URL]);
      const attachmentIndex = argv.indexOf('--attachments');
      const output = path.join(argv[attachmentIndex + 1], 'acceptance', 'dr-canary.bin');
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, canary);
    },
    async createMySqlProductionWorkbench() {
      return {
        async start() { events.push(['workbench-start']); return { port: 4317 }; },
        async stop() { events.push(['workbench-stop']); }
      };
    },
    async login() {
      events.push(['login']);
      return { response: { status: 200 }, cookie: 'private' };
    },
    async requestJson({ path: requestPath }) {
      events.push(['http', requestPath]);
      if (requestPath.endsWith('/events?afterSequence=0&limit=1000')) {
        return {
          hasMore: false,
          events: Array.from({ length: terminalCount }, (_, index) => ({
            jobId: `job-${index + 1}`,
            type: 'job.completed'
          }))
        };
      }
      return { conversation: { id: 'conversation-1' } };
    }
  };
}

test('uses the configured attachment root and verifies the target before restore', async (t) => {
  const { root, attachmentRoot, env, recovery } = setup(t);
  const events = [];
  const summary = await runProductionDrAcceptance({
    env,
    root,
    recovery,
    memberPassword: 'not-logged',
    projectDir: root,
    dependencies: createHappyDependencies(events)
  });

  assert.deepEqual(summary, {
    enabled: true,
    databaseRestored: true,
    attachmentRestored: true,
    persistedJobs: 5
  });
  assert.equal(Object.isFrozen(summary), true);
  assert.equal(events[0][0], 'backup');
  assert.equal(events[0][1][events[0][1].indexOf('--attachments') + 1], attachmentRoot);
  assert.deepEqual(events.map(([name]) => name).slice(0, 5), [
    'backup', 'capabilities', 'empty-check', 'database-close', 'restore'
  ]);
  assert.equal(events.at(-1)[0], 'workbench-stop');
  for (const [name, argv] of events.filter(([name]) => ['backup', 'restore'].includes(name))) {
    assert.equal(argv.some((value) => value.includes('secret')), false, `${name} argv exposed the database URL`);
  }
});

test('closes the target connection and refuses restore when the target is non-empty', async (t) => {
  const { root, env, recovery } = setup(t);
  const events = [];
  const dependencies = createHappyDependencies(events);
  dependencies.createMySqlDatabase = async () => ({
    async assertCapabilities() { events.push(['capabilities']); },
    async one() { events.push(['empty-check']); return { count: 1 }; },
    async close() { events.push(['database-close']); }
  });

  await assert.rejects(
    runProductionDrAcceptance({
      env,
      root,
      recovery,
      memberPassword: 'not-logged',
      projectDir: root,
      dependencies
    }),
    /must be empty/
  );
  assert.deepEqual(events.map(([name]) => name), [
    'backup', 'capabilities', 'empty-check', 'database-close'
  ]);
});

test('stops the restored workbench when HTTP verification fails', async (t) => {
  const { root, env, recovery } = setup(t);
  const events = [];
  const dependencies = createHappyDependencies(events, 4);

  await assert.rejects(
    runProductionDrAcceptance({
      env,
      root,
      recovery,
      memberPassword: 'not-logged',
      projectDir: root,
      dependencies
    }),
    /exactly one terminal event/
  );
  assert.equal(events.at(-1)[0], 'workbench-stop');
});
