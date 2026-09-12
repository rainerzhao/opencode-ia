'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateProductionConfig } = require('../../scripts/check-production-config');

const baseEnv = {
  NODE_ENV: 'production',
  WORKBENCH_DATABASE_URL: 'mysql://app:secret@mysql:3306/workbench',
  COOKIE_SECURE: 'true',
  OPENCODE_CMD: '/opt/opencode/bin/opencode',
  OPENCODE_VERIFIED_VERSION: '1.18.25',
  OPENCODE_CWD: '/var/lib/opencode-workbench/runtime',
  GATEWAY_GLOBAL_RUNNING: '2',
  OPENCODE_WORKER_COUNT: '2',
  OPENCODE_WORKER_CAPACITY: '1'
};

test('accepts a MySQL-only non-root production configuration without exposing secrets', () => {
  const result = validateProductionConfig({ env: baseEnv, uid: 1001, commandExists: true });
  assert.deepEqual(result, { database: 'mysql', cookieSecure: true, runtime: '/opt/opencode/bin/opencode', uid: 1001 });
});

test('rejects production configuration that can silently fall back to SQLite', () => {
  assert.throws(() => validateProductionConfig({ env: { ...baseEnv, WORKBENCH_DATABASE_URL: '' }, uid: 1001, commandExists: true }), /WORKBENCH_DATABASE_URL/);
  assert.throws(() => validateProductionConfig({ env: { ...baseEnv, DATABASE_PATH: '/var/lib/workbench.db' }, uid: 1001, commandExists: true }), /DATABASE_PATH/);
});

test('rejects unsafe runtime and root execution before startup', () => {
  assert.throws(() => validateProductionConfig({ env: { ...baseEnv, COOKIE_SECURE: 'false' }, uid: 1001, commandExists: true }), /COOKIE_SECURE/);
  assert.throws(() => validateProductionConfig({ env: baseEnv, uid: 0, commandExists: true }), /root/);
  assert.throws(() => validateProductionConfig({ env: baseEnv, uid: 1001, commandExists: false }), /OPENCODE_CMD/);
});

test('rejects a running limit that exceeds the configured worker pool', () => {
  assert.throws(() => validateProductionConfig({
    env: { ...baseEnv, GATEWAY_GLOBAL_RUNNING: '3' }, uid: 1001, commandExists: true
  }), /worker capacity/);
});
