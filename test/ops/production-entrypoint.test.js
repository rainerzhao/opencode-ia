'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadEntrypoint() {
  try { return require('../../scripts/start-production'); } catch { return {}; }
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'production-entrypoint-'));
  const command = path.join(root, 'opencode');
  const provider = path.join(root, 'opencode.json');
  fs.writeFileSync(command, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  fs.writeFileSync(provider, JSON.stringify({
    model: 'internal/model',
    provider: { internal: { options: { baseURL: 'https://model.intra.example/v1', apiKey: '${INTERNAL_MODEL_API_KEY}' } } }
  }), { mode: 0o600 });
  fs.chmodSync(provider, 0o600);
  const uid = process.getuid() === 0 ? 1001 : process.getuid();
  if (process.getuid() === 0) fs.chownSync(provider, uid, uid);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    root,
    uid,
    env: {
      NODE_ENV: 'production', WORKBENCH_DATABASE_URL: 'mysql://app:secret@mysql:3306/workbench', COOKIE_SECURE: 'true',
      OPENCODE_CMD: command, OPENCODE_CONFIG_FILE: provider, OPENCODE_CWD: root,
      OPENCODE_VERIFIED_VERSION: '1.18.25', GATEWAY_GLOBAL_RUNNING: '2', OPENCODE_WORKER_COUNT: '2', OPENCODE_WORKER_CAPACITY: '1'
    }
  };
}

test('runs both production gates before opening the server', async (t) => {
  const { startCheckedProduction } = loadEntrypoint();
  assert.equal(typeof startCheckedProduction, 'function');
  const input = fixture(t);
  let started = false;
  const result = await startCheckedProduction({
    env: input.env, projectDir: input.root, uid: input.uid, logger: { log() {} },
    start: async () => { started = true; return 'started'; }
  });
  assert.equal(started, true);
  assert.equal(result, 'started');
});

test('does not open the server when the Provider gate fails', async (t) => {
  const { startCheckedProduction } = loadEntrypoint();
  assert.equal(typeof startCheckedProduction, 'function');
  const input = fixture(t);
  fs.chmodSync(input.env.OPENCODE_CONFIG_FILE, 0o644);
  let started = false;
  await assert.rejects(() => startCheckedProduction({
    env: input.env, projectDir: input.root, uid: input.uid, logger: { log() {} },
    start: async () => { started = true; }
  }), /0600/);
  assert.equal(started, false);
});

test('uses the same service account identity for both production gates', async (t) => {
  const { startCheckedProduction } = loadEntrypoint();
  const input = fixture(t);
  let started = false;
  await assert.rejects(() => startCheckedProduction({
    env: input.env, projectDir: input.root, uid: input.uid + 1, logger: { log() {} },
    start: async () => { started = true; }
  }), /owned by the service account/);
  assert.equal(started, false);
});
