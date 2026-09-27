'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProductionCapacityProfile } = require('../../src/gateway/production-capacity-profile');

const baseEnv = Object.freeze({
  WORKBENCH_PRODUCTION_CAPACITY_ACCEPTANCE: '1',
  WORKBENCH_DATABASE_URL: 'mysqls://acceptance:secret@mysql.intra.example/opencode_acceptance_20260924',
  OPENCODE_WORKER_COUNT: '4',
  OPENCODE_WORKER_CAPACITY: '5',
  GATEWAY_GLOBAL_RUNNING: '20',
  GATEWAY_USER_RUNNING: '1',
  MAX_SESSIONS: '20'
});

test('requires an explicit production-capacity gate and Linux', () => {
  assert.throws(
    () => loadProductionCapacityProfile({ env: {}, platform: 'linux' }),
    (error) => error.code === 'PRODUCTION_CAPACITY_GATE_REQUIRED'
  );
  assert.throws(
    () => loadProductionCapacityProfile({ env: baseEnv, platform: 'darwin' }),
    (error) => error.code === 'PRODUCTION_CAPACITY_LINUX_REQUIRED'
  );
  assert.throws(
    () => loadProductionCapacityProfile({
      env: { ...baseEnv, WORKBENCH_PRODUCTION_CAPACITY_ACCEPTANCE: 'true' },
      platform: 'linux'
    }),
    (error) => error.code === 'PRODUCTION_CAPACITY_GATE_REQUIRED'
  );
});

test('requires a dedicated acceptance database without exposing its URL', () => {
  const unsafe = {
    ...baseEnv,
    WORKBENCH_DATABASE_URL: 'mysqls://production-user:top-secret@mysql.intra.example/workbench'
  };
  assert.throws(
    () => loadProductionCapacityProfile({ env: unsafe, platform: 'linux' }),
    (error) => {
      assert.equal(error.code, 'PRODUCTION_CAPACITY_DATABASE_REQUIRED');
      assert.doesNotMatch(error.message, /top-secret|production-user|mysql\.intra/);
      return true;
    }
  );
  assert.throws(
    () => loadProductionCapacityProfile({
      env: {
        ...baseEnv,
        WORKBENCH_DATABASE_URL: 'mysql://acceptance:secret@mysql.intra.example/opencode_acceptance_20260924'
      },
      platform: 'linux'
    }),
    (error) => error.code === 'PRODUCTION_CAPACITY_DATABASE_REQUIRED'
  );
});

test('requires the fixed twenty-active-task production topology', () => {
  for (const [name, value] of [
    ['OPENCODE_WORKER_COUNT', '2'],
    ['OPENCODE_WORKER_CAPACITY', '4'],
    ['GATEWAY_GLOBAL_RUNNING', '10'],
    ['GATEWAY_USER_RUNNING', '2'],
    ['MAX_SESSIONS', '19']
  ]) {
    assert.throws(
      () => loadProductionCapacityProfile({ env: { ...baseEnv, [name]: value }, platform: 'linux' }),
      (error) => error.code === 'PRODUCTION_CAPACITY_TOPOLOGY_INVALID'
    );
  }
});

test('returns only a frozen redacted twenty-user profile', () => {
  const profile = loadProductionCapacityProfile({ env: baseEnv, platform: 'linux' });
  assert.deepEqual(profile, {
    name: 'production-mysql-twenty-user',
    database: 'mysql-dedicated-acceptance',
    users: 20,
    connections: 20,
    conversationsPerUser: 3,
    conversations: 60,
    rounds: 3,
    tasks: 180,
    workerCount: 4,
    workerCapacity: 5,
    executionSlots: 20,
    userRunning: 1
  });
  assert.equal(Object.isFrozen(profile), true);
  assert.doesNotMatch(JSON.stringify(profile), /secret|mysql\.intra|opencode_acceptance_20260924/);
});
