'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPromptRunner } = require('../../src/opencode/run-prompt');

const fixturePath = path.resolve(__dirname, '../fixtures/fake-opencode.js');

function createFixtureRunner(tempDir, overrides = {}) {
  const { baseArgs = [fixturePath], ...runnerOptions } = overrides;
  return createPromptRunner({
    command: process.execPath,
    baseArgs,
    cwd: tempDir,
    timeoutMs: 2000,
    maxOutputBytes: 1024 * 1024,
    killGraceMs: 100,
    ...runnerOptions
  });
}

function useTempDir(t) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-runner-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  return tempDir;
}

function createReadinessLatch() {
  let resolveReady;
  const wait = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let seen = false;

  return {
    wait,
    get seen() {
      return seen;
    },
    onEvent(event) {
      if (event.type !== 'fixture-ready' || seen) return;
      seen = true;
      resolveReady();
    }
  };
}

test('passes shell metacharacters as one message argument', async (t) => {
  const tempDir = useTempDir(t);

  const marker = path.join(tempDir, 'must-not-exist');
  const runner = createFixtureRunner(tempDir);
  const prompt = `hello"; touch ${marker}; echo "world`;

  const result = await runner.runPrompt(prompt);

  assert.equal(result.text, prompt);
  assert.equal(fs.existsSync(marker), false);
});

for (const prompt of [
  '--auto',
  '--file=/tmp/private.txt',
  '--model=untrusted/model',
  '--attach=untrusted-session',
  '--dir=/tmp/untrusted',
  '--share'
]) {
  test(`passes leading-dash input as message text: ${prompt}`, async (t) => {
    const tempDir = useTempDir(t);
    const runner = createFixtureRunner(tempDir);

    const result = await runner.runPrompt(prompt);

    assert.equal(result.text, prompt);
    assert.deepEqual(result.events, [
      { type: 'text', part: { text: prompt } }
    ]);
  });
}

test('terminates a delayed process after the configured timeout', async (t) => {
  const tempDir = useTempDir(t);
  const marker = path.join(tempDir, 'timeout-terminated');
  const runner = createFixtureRunner(tempDir, {
    baseArgs: [fixturePath, `--term-marker=${marker}`],
    timeoutMs: 1000
  });
  const readiness = createReadinessLatch();

  const run = runner.runPrompt('__TEST_DELAY__', { onEvent: readiness.onEvent });

  await Promise.race([readiness.wait, run]);
  assert.equal(readiness.seen, true);
  await assert.rejects(run, { code: 'OPENCODE_TIMEOUT' });
  assert.equal(fs.readFileSync(marker, 'utf8'), 'terminated');
});

test('aborts and terminates a running process when signaled', async (t) => {
  const tempDir = useTempDir(t);
  const marker = path.join(tempDir, 'abort-terminated');
  const runner = createFixtureRunner(tempDir, {
    baseArgs: [fixturePath, `--term-marker=${marker}`]
  });
  const controller = new AbortController();
  const readiness = createReadinessLatch();
  const run = runner.runPrompt('__TEST_DELAY__', {
    signal: controller.signal,
    onEvent: readiness.onEvent
  });

  await Promise.race([readiness.wait, run]);
  controller.abort();

  await assert.rejects(run, { code: 'OPENCODE_ABORTED' });
  assert.equal(readiness.seen, true);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'terminated');
});

test('limits the combined stdout and stderr byte count', async (t) => {
  const tempDir = useTempDir(t);
  const runner = createFixtureRunner(tempDir, { maxOutputBytes: 256 });

  await assert.rejects(runner.runPrompt('__TEST_OVERSIZE__'), {
    code: 'OPENCODE_OUTPUT_LIMIT'
  });
});

test('maps a non-zero process exit to a stable error code', async (t) => {
  const tempDir = useTempDir(t);
  const runner = createFixtureRunner(tempDir);

  await assert.rejects(runner.runPrompt('__TEST_NONZERO__'), {
    code: 'OPENCODE_EXIT_ERROR'
  });
});

test('rejects a successful process that emits no text response', async (t) => {
  const tempDir = useTempDir(t);
  const runner = createFixtureRunner(tempDir);

  await assert.rejects(runner.runPrompt('__TEST_EMPTY__'), {
    code: 'OPENCODE_EMPTY_RESPONSE'
  });
});

test('escalates to SIGKILL when a timed-out child ignores SIGTERM', async (t) => {
  const tempDir = useTempDir(t);
  const termMarker = path.join(tempDir, 'sigterm-received');
  const pidMarker = path.join(tempDir, 'child.pid');
  const runner = createFixtureRunner(tempDir, {
    baseArgs: [
      fixturePath,
      `--term-marker=${termMarker}`,
      `--pid-marker=${pidMarker}`
    ],
    timeoutMs: 1000,
    killGraceMs: 100
  });
  const readiness = createReadinessLatch();

  const run = runner.runPrompt('__TEST_IGNORE_SIGTERM__', {
    onEvent: readiness.onEvent
  });

  await Promise.race([readiness.wait, run]);
  assert.equal(readiness.seen, true);
  await assert.rejects(run, { code: 'OPENCODE_TIMEOUT' });
  assert.equal(fs.readFileSync(termMarker, 'utf8'), 'terminated');
  const childPid = Number(fs.readFileSync(pidMarker, 'utf8'));
  assert.ok(Number.isSafeInteger(childPid));
  assert.throws(
    () => process.kill(childPid, 0),
    (error) => error && error.code === 'ESRCH'
  );
});

test('parses line JSON split across stdout chunks and a UTF-8 boundary', async (t) => {
  const tempDir = useTempDir(t);
  const runner = createFixtureRunner(tempDir);
  const observedEvents = [];

  const result = await runner.runPrompt('__TEST_CHUNKED_UTF8__', {
    onEvent: (event) => observedEvents.push(event)
  });

  const expectedEvents = [
    { type: 'text', part: { text: '开头' } },
    { type: 'status', status: 'working' },
    { type: 'text', part: { text: '中间🙂' } },
    { type: 'text', part: { text: '结尾' } }
  ];
  assert.equal(result.text, '开头中间🙂结尾');
  assert.deepEqual(result.events, expectedEvents);
  assert.deepEqual(observedEvents, expectedEvents);
});
