'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { createWorkerProcess } = require('../../src/gateway/worker-process');

test('real OpenCode retains Session identity in persistent XDG data after a fresh worker starts', {
  skip: process.env.WORKBENCH_RUNTIME_STORAGE_ACCEPTANCE !== '1', timeout: 90000
}, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-persistence-'));
  let worker;
  t.after(async () => { await worker?.stop(); fs.rmSync(root, { recursive: true, force: true }); });
  const cwd = path.join(root, 'runtime');
  const workspace = path.join(root, 'workspaces', 'conversation');
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  const reservation = net.createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const env = {
    PATH: process.env.PATH, HOME: path.join(root, 'home'),
    XDG_DATA_HOME: path.join(root, 'xdg/data'), XDG_STATE_HOME: path.join(root, 'xdg/state'),
    XDG_CONFIG_HOME: path.join(root, 'xdg/config'), XDG_CACHE_HOME: path.join(root, 'xdg/cache')
  };
  function freshWorker() {
    return createWorkerProcess({ command: process.env.OPENCODE_CMD || 'opencode', cwd, port, env,
      expectedVersion: '1.18.25', startupTimeoutMs: 30000, logger: { log() {}, error() {} } });
  }
  worker = freshWorker();
  await worker.start();
  const session = await worker.client.createSession({ directory: workspace, title: 'persistent-session-test' });
  assert.equal(typeof session.id, 'string');
  await worker.stop();
  assert.equal(fs.existsSync(path.join(env.XDG_DATA_HOME, 'opencode')), true);
  worker = freshWorker();
  await worker.start();
  const restored = await worker.client.getSession({ sessionId: session.id, directory: workspace });
  assert.equal(restored.id, session.id);
  assert.equal(restored.title, 'persistent-session-test');
});
