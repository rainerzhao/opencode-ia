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
