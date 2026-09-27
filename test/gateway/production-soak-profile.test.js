'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProductionSoakProfile } = require('../../src/gateway/production-soak-profile');
const { createProductionSoakSchedule } = require('../fixtures/production-soak');

const baseEnv = Object.freeze({
  WORKBENCH_PRODUCTION_CAPACITY_ACCEPTANCE: '1',
  WORKBENCH_PRODUCTION_RECOVERY_ACCEPTANCE: '1',
  WORKBENCH_PRODUCTION_SOAK_ACCEPTANCE: '1',
  WORKBENCH_PRODUCTION_SOAK_MINUTES: '480',
  WORKBENCH_PRODUCTION_SOAK_INTERVAL_SECONDS: '900',
  WORKBENCH_DATABASE_URL: 'mysqls://acceptance:secret@mysql.intra.example/opencode_acceptance_20260927',
  OPENCODE_WORKER_COUNT: '4',
  OPENCODE_WORKER_CAPACITY: '5',
  GATEWAY_GLOBAL_RUNNING: '20',
  GATEWAY_USER_RUNNING: '1',
  MAX_SESSIONS: '20'
});
test('requires exact capacity, recovery and soak gates on Linux', () => {
  for (const [name, value, code] of [
    ['WORKBENCH_PRODUCTION_CAPACITY_ACCEPTANCE', 'true', 'PRODUCTION_CAPACITY_GATE_REQUIRED'],
    ['WORKBENCH_PRODUCTION_RECOVERY_ACCEPTANCE', 'true', 'PRODUCTION_SOAK_RECOVERY_GATE_REQUIRED'],
    ['WORKBENCH_PRODUCTION_SOAK_ACCEPTANCE', 'true', 'PRODUCTION_SOAK_GATE_REQUIRED']
  ]) {
    assert.throws(
      () => loadProductionSoakProfile({ env: { ...baseEnv, [name]: value }, platform: 'linux' }),
      (error) => error.code === code
    );
  }
  assert.throws(
    () => loadProductionSoakProfile({ env: baseEnv, platform: 'darwin' }),
    (error) => error.code === 'PRODUCTION_CAPACITY_LINUX_REQUIRED'
  );
});

test('bounds soak duration and interval and requires four cohorts', () => {
  for (const [name, value, code] of [
    ['WORKBENCH_PRODUCTION_SOAK_MINUTES', '59', 'PRODUCTION_SOAK_DURATION_INVALID'],
    ['WORKBENCH_PRODUCTION_SOAK_MINUTES', '1441', 'PRODUCTION_SOAK_DURATION_INVALID'],
    ['WORKBENCH_PRODUCTION_SOAK_MINUTES', '60.5', 'PRODUCTION_SOAK_DURATION_INVALID'],
    ['WORKBENCH_PRODUCTION_SOAK_INTERVAL_SECONDS', '59', 'PRODUCTION_SOAK_INTERVAL_INVALID'],
    ['WORKBENCH_PRODUCTION_SOAK_INTERVAL_SECONDS', '3601', 'PRODUCTION_SOAK_INTERVAL_INVALID'],
    ['WORKBENCH_PRODUCTION_SOAK_INTERVAL_SECONDS', '900.5', 'PRODUCTION_SOAK_INTERVAL_INVALID']
  ]) {
    assert.throws(
      () => loadProductionSoakProfile({ env: { ...baseEnv, [name]: value }, platform: 'linux' }),
      (error) => error.code === code
    );
  }
  assert.throws(
    () => loadProductionSoakProfile({
      env: {
        ...baseEnv,
        WORKBENCH_PRODUCTION_SOAK_MINUTES: '60',
        WORKBENCH_PRODUCTION_SOAK_INTERVAL_SECONDS: '1800'
      },
      platform: 'linux'
    }),
    (error) => error.code === 'PRODUCTION_SOAK_COVERAGE_INVALID'
  );
});

test('returns a frozen redacted production soak profile', () => {
  const profile = loadProductionSoakProfile({ env: baseEnv, platform: 'linux' });
  assert.deepEqual(profile, {
    name: 'production-mysql-twenty-user-soak',
    durationMinutes: 480,
    intervalSeconds: 900,
    durationMs: 28_800_000,
    intervalMs: 900_000,
    users: 20,
    cohortSize: 5,
    cycles: 32
  });
  assert.equal(Object.isFrozen(profile), true);
  assert.doesNotMatch(JSON.stringify(profile), /secret|mysql\.intra|acceptance_20260927/);
});

test('rotates five-user cohorts across all twenty users before repeating', () => {
  const schedule = createProductionSoakSchedule({
    users: 20,
    cohortSize: 5,
    durationMs: 4_500_000,
    intervalMs: 900_000
  });
  assert.deepEqual(schedule.map((cycle) => cycle.userIndexes), [
    [0, 1, 2, 3, 4],
    [5, 6, 7, 8, 9],
    [10, 11, 12, 13, 14],
    [15, 16, 17, 18, 19],
    [0, 1, 2, 3, 4]
  ]);
  assert.deepEqual(schedule.map((cycle) => cycle.offsetMs), [0, 900_000, 1_800_000, 2_700_000, 3_600_000]);
  assert.equal(Object.isFrozen(schedule), true);
  assert.equal(schedule.every((cycle) => Object.isFrozen(cycle) && Object.isFrozen(cycle.userIndexes)), true);
});

test('rejects invalid or under-covered schedules', () => {
  for (const input of [
    { users: 0, cohortSize: 5, durationMs: 3_600_000, intervalMs: 900_000 },
    { users: 20, cohortSize: 21, durationMs: 3_600_000, intervalMs: 900_000 },
    { users: 20, cohortSize: 5, durationMs: 0, intervalMs: 900_000 },
    { users: 20, cohortSize: 5, durationMs: 3_600_000, intervalMs: 0 },
    { users: 20, cohortSize: 5, durationMs: 3_600_000, intervalMs: 1_800_000 }
  ]) {
    assert.throws(() => createProductionSoakSchedule(input), TypeError);
  }
});
