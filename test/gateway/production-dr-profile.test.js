'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');
const { loadProductionDrProfile } = require('../../src/gateway/production-dr-profile');

const baseEnv = Object.freeze({
  WORKBENCH_PRODUCTION_CAPACITY_ACCEPTANCE: '1',
  WORKBENCH_PRODUCTION_RECOVERY_ACCEPTANCE: '1',
  WORKBENCH_PRODUCTION_SOAK_ACCEPTANCE: '1',
  WORKBENCH_PRODUCTION_DR_ACCEPTANCE: '1',
  WORKBENCH_PRODUCTION_SOAK_MINUTES: '480',
  WORKBENCH_PRODUCTION_SOAK_INTERVAL_SECONDS: '900',
  WORKBENCH_DATABASE_URL: 'mysqls://source:secret@mysql-source.intra.example/opencode_acceptance_20260928',
  WORKBENCH_RECOVERY_DATABASE_URL: 'mysqls://target:secret@mysql-target.intra.example/opencode_recovery_acceptance_20260928',
  OPENCODE_WORKER_COUNT: '4',
  OPENCODE_WORKER_CAPACITY: '5',
  GATEWAY_GLOBAL_RUNNING: '20',
  GATEWAY_USER_RUNNING: '1',
  MAX_SESSIONS: '20'
});

test('requires the exact DR gate and the complete soak profile', () => {
  assert.throws(
    () => loadProductionDrProfile({ env: { ...baseEnv, WORKBENCH_PRODUCTION_DR_ACCEPTANCE: 'true' }, platform: 'linux' }),
    (error) => error.code === 'PRODUCTION_DR_GATE_REQUIRED'
  );
  assert.throws(
    () => loadProductionDrProfile({ env: { ...baseEnv, WORKBENCH_PRODUCTION_SOAK_ACCEPTANCE: 'true' }, platform: 'linux' }),
    (error) => error.code === 'PRODUCTION_SOAK_GATE_REQUIRED'
  );
});

test('requires a distinct TLS recovery acceptance database', () => {
  for (const target of [
    'mysql://target:secret@mysql-target.intra.example/opencode_recovery_acceptance_20260928',
    'mysqls://target:secret@mysql-target.intra.example/opencode_acceptance_20260928',
    'mysqls://target:secret@mysql-target.intra.example/opencode_recovery_20260928',
    'not-a-url'
  ]) {
    assert.throws(
      () => loadProductionDrProfile({
        env: { ...baseEnv, WORKBENCH_RECOVERY_DATABASE_URL: target },
        platform: 'linux'
      }),
      (error) => error.code === 'PRODUCTION_DR_TARGET_REQUIRED'
    );
  }
  assert.throws(
    () => loadProductionDrProfile({
      env: { ...baseEnv, WORKBENCH_RECOVERY_DATABASE_URL: baseEnv.WORKBENCH_DATABASE_URL },
      platform: 'linux'
    }),
    (error) => error.code === 'PRODUCTION_DR_TARGET_CONFLICT'
  );
});

test('validates an independent target CA without returning its path', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'production-dr-profile-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ca = path.join(root, 'target-ca.pem');
  fs.writeFileSync(ca, tls.rootCertificates[0]);
  const profile = loadProductionDrProfile({
    env: { ...baseEnv, WORKBENCH_RECOVERY_MYSQL_SSL_CA_FILE: ca },
    platform: 'linux'
  });
  assert.deepEqual(profile, {
    name: 'production-mysql-disaster-recovery',
    source: 'mysql-dedicated-acceptance',
    target: 'mysql-dedicated-recovery',
    targetCaFileConfigured: true
  });
  assert.equal(Object.isFrozen(profile), true);
  assert.doesNotMatch(JSON.stringify(profile), /secret|mysql-source|mysql-target|opencode_|target-ca|production-dr-profile/);
});

test('returns a frozen redacted profile when system trust is used', () => {
  const profile = loadProductionDrProfile({ env: baseEnv, platform: 'linux' });
  assert.deepEqual(profile, {
    name: 'production-mysql-disaster-recovery',
    source: 'mysql-dedicated-acceptance',
    target: 'mysql-dedicated-recovery',
    targetCaFileConfigured: false
  });
  assert.equal(Object.isFrozen(profile), true);
});
