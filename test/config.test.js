const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadConfig } = require('../src/config');

test('derives data paths from the injected project directory', () => {
  const config = loadConfig({ env: {}, projectDir: '/srv/workbench' });
  assert.equal(config.knowledgeDir, path.resolve('/srv/workbench/knowledge'));
  assert.equal(config.solutionsDir, path.resolve('/srv/workbench/solutions'));
  assert.equal(config.databasePath, path.resolve('/srv/workbench/data/workbench.db'));
  assert.equal(config.staticDir, path.resolve('/srv/workbench/dist/web'));
  assert.equal(config.port, 3000);
  assert.equal(config.cookieSecure, false);
  assert.equal(config.sessionTtlSeconds, 8 * 60 * 60);
  assert.equal(config.loginMaxFailures, 5);
  assert.equal(config.loginWindowSeconds, 15 * 60);
  assert.equal(config.loginLockSeconds, 15 * 60);
  assert.equal(config.opencodeWorkerBasePort, 4319);
  assert.equal(config.opencodeWorkerCount, 2);
  assert.equal(config.opencodeWorkerHeartbeatMs, 5000);
  assert.equal(config.opencodeWorkerHeartbeatTimeoutMs, 2000);
  assert.equal(config.gatewayGlobalRunning, 2);
  assert.equal(config.gatewayUserRunning, 1);
  assert.equal(config.gatewayUserQueued, 3);
  assert.equal(config.gatewayWorkspaceRoot, path.resolve('/srv/workbench/data/workspaces'));
  assert.equal(config.opencodeWorkerStartupTimeoutMs, 10000);
  assert.equal(config.opencodeWorkerReadinessIntervalMs, 100);
  assert.equal(config.opencodeWorkerStopGraceMs, 2000);
  assert.equal(config.opencodeWorkerKillGraceMs, 1000);
  assert.equal(config.opencodeWorkerUsername, 'opencode');
  assert.equal(config.opencodeVerifiedVersion, '1.18.25');
});

test('accepts an explicit database path without placing it in source directories', () => {
  const config = loadConfig({
    env: { DATABASE_PATH: '/var/lib/opencode-workbench/workbench.db' },
    projectDir: '/srv/workbench'
  });
  assert.equal(config.databasePath, '/var/lib/opencode-workbench/workbench.db');
});

test('rejects invalid positive integer limits', () => {
  assert.throws(
    () => loadConfig({ env: { MAX_SESSIONS: '0' }, projectDir: '/srv/workbench' }),
    /MAX_SESSIONS/
  );
});

test('rejects non-integer environment overrides', () => {
  assert.throws(
    () => loadConfig({ env: { PORT: '3000.5' }, projectDir: '/srv/workbench' }),
    /PORT/
  );
});

test('loads bounded persistent OpenCode worker settings without a stored password', () => {
  const config = loadConfig({
    env: {
      OPENCODE_WORKER_BASE_PORT: '4400',
      OPENCODE_WORKER_COUNT: '3',
      OPENCODE_WORKER_HEARTBEAT_MS: '6000',
      OPENCODE_WORKER_HEARTBEAT_TIMEOUT_MS: '2500',
      GATEWAY_GLOBAL_RUNNING: '3',
      GATEWAY_USER_RUNNING: '1',
      GATEWAY_USER_QUEUED: '4',
      GATEWAY_WORKSPACE_ROOT: '/var/lib/opencode-workbench/workspaces',
      OPENCODE_WORKER_STARTUP_TIMEOUT_MS: '15000',
      OPENCODE_WORKER_READINESS_INTERVAL_MS: '250',
      OPENCODE_WORKER_STOP_GRACE_MS: '3000',
      OPENCODE_WORKER_KILL_GRACE_MS: '1500',
      OPENCODE_WORKER_USERNAME: 'internal-worker',
      OPENCODE_VERIFIED_VERSION: '1.18.25'
    },
    projectDir: '/srv/workbench'
  });

  assert.equal(config.opencodeWorkerBasePort, 4400);
  assert.equal(config.opencodeWorkerCount, 3);
  assert.equal(config.opencodeWorkerHeartbeatMs, 6000);
  assert.equal(config.opencodeWorkerHeartbeatTimeoutMs, 2500);
  assert.equal(config.gatewayGlobalRunning, 3);
  assert.equal(config.gatewayUserRunning, 1);
  assert.equal(config.gatewayUserQueued, 4);
  assert.equal(config.gatewayWorkspaceRoot, '/var/lib/opencode-workbench/workspaces');
  assert.equal(config.opencodeWorkerStartupTimeoutMs, 15000);
  assert.equal(config.opencodeWorkerReadinessIntervalMs, 250);
  assert.equal(config.opencodeWorkerStopGraceMs, 3000);
  assert.equal(config.opencodeWorkerKillGraceMs, 1500);
  assert.equal(config.opencodeWorkerUsername, 'internal-worker');
  assert.equal(config.opencodeVerifiedVersion, '1.18.25');
  assert.equal(Object.hasOwn(config, 'opencodeWorkerPassword'), false);
});

test('rejects an invalid worker port and unsafe worker identity text', () => {
  assert.throws(
    () => loadConfig({ env: { OPENCODE_WORKER_BASE_PORT: '70000' }, projectDir: '/srv/workbench' }),
    /OPENCODE_WORKER_BASE_PORT/
  );
  assert.throws(
    () => loadConfig({ env: { OPENCODE_WORKER_USERNAME: 'bad\nname' }, projectDir: '/srv/workbench' }),
    /OPENCODE_WORKER_USERNAME/
  );
  assert.throws(
    () => loadConfig({
      env: { OPENCODE_WORKER_BASE_PORT: '65535', OPENCODE_WORKER_COUNT: '2' },
      projectDir: '/srv/workbench'
    }),
    /OPENCODE_WORKER_BASE_PORT/
  );
});

test('loads authentication security settings from explicit environment values', () => {
  const config = loadConfig({
    env: {
      COOKIE_SECURE: 'true',
      SESSION_TTL_SECONDS: '7200',
      LOGIN_MAX_FAILURES: '7',
      LOGIN_WINDOW_SECONDS: '120',
      LOGIN_LOCK_SECONDS: '300'
    },
    projectDir: '/srv/workbench'
  });

  assert.equal(config.cookieSecure, true);
  assert.equal(config.sessionTtlSeconds, 7200);
  assert.equal(config.loginMaxFailures, 7);
  assert.equal(config.loginWindowSeconds, 120);
  assert.equal(config.loginLockSeconds, 300);
});

test('rejects ambiguous cookie security values', () => {
  assert.throws(
    () => loadConfig({ env: { COOKIE_SECURE: 'yes' }, projectDir: '/srv/workbench' }),
    /COOKIE_SECURE/
  );
});
