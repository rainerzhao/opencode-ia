'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProductionWorkbench } = require('../../apps/server');

test('production lifecycle starts and stops two persistent Gateway workers', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'production-gateway-'));
  const starts = [];
  const stops = [];
  const workbench = createProductionWorkbench({
    projectDir: root,
    env: {
      HOME: root,
      WORKBENCH_ROOT: root,
      WEB_DIST_DIR: path.join(root, 'web'),
      OPENCODE_CMD: '/unused/opencode',
      OPENCODE_CWD: root,
      COOKIE_SECURE: 'false'
    },
    logger: { log() {}, error() {} },
    workerFactory({ id, onExit }) {
      return {
        client: {
          createSession: async () => ({ id: `session-${id}` }),
          prompt: async () => ({ parts: [{ type: 'text', text: 'ok' }] }),
          abortSession: async () => ({})
        },
        async start() {
          starts.push(id);
          return { status: 'healthy' };
        },
        async stop() {
          stops.push(id);
          return { status: 'stopped' };
        },
        async health() { return { healthy: true }; },
        snapshot() {
          return { status: 'healthy', endpoint: `http://127.0.0.1/${id}`, version: '1.18.25' };
        },
        onExit
      };
    }
  });
  t.after(async () => {
    await workbench.stop().catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  });

  await workbench.start(0, '127.0.0.1');

  assert.deepEqual(starts, ['worker-1', 'worker-2']);
  assert.equal(workbench.gatewayService.snapshot().status, 'running');
  assert.equal(workbench.gatewayService.snapshot().pool.workers.length, 2);

  await workbench.stop();
  assert.deepEqual(stops, ['worker-1', 'worker-2']);
  assert.equal(workbench.gatewayService.snapshot().status, 'stopped');
});
