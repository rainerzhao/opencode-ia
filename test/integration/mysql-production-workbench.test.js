'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMySqlDatabase } = require('../../src/db/mysql-database');
const { migrateMySqlDatabase } = require('../../src/db/mysql-migrate');
const { clearMySqlBusinessData } = require('../fixtures/mysql-test-database');
const { createMySqlIdentityRepositories } = require('../../src/auth/mysql-identity-repositories');
const { bootstrapAdmin } = require('../../src/bootstrap/bootstrap-admin');
const { createMySqlProductionWorkbench } = require('../../apps/server');

const testUrl = process.env.WORKBENCH_TEST_MYSQL_URL;
const ADMIN_PASSWORD = 'MySQL Production Admin 2026!';

function setCookies(response) {
  return typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
}

function cookieJar(headers) { return headers.map((header) => header.split(';', 1)[0]).join('; '); }
function cookieValue(headers, name) {
  const prefix = `${name}=`;
  const item = headers.map((header) => header.split(';', 1)[0]).find((value) => value.startsWith(prefix));
  return item ? decodeURIComponent(item.slice(prefix.length)) : null;
}

test('starts the MySQL production composition and serves authenticated private Conversation HTTP', { skip: !testUrl }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mysql-production-workbench-'));
  const cleanupDb = await createMySqlDatabase({ url: testUrl, poolSize: 2 });
  await migrateMySqlDatabase(cleanupDb);
  await clearMySqlBusinessData(cleanupDb, { url: testUrl });
  await cleanupDb.close();

  const env = {
    HOME: root,
    WORKBENCH_ROOT: root,
    WORKBENCH_DATABASE_URL: testUrl,
    MYSQL_POOL_SIZE: '4',
    WEB_DIST_DIR: path.join(root, 'web'),
    OPENCODE_CMD: '/unused/opencode',
    OPENCODE_CWD: root,
    COOKIE_SECURE: 'false',
    OPENCODE_WORKER_COUNT: '1',
    OPENCODE_WORKER_BASE_PORT: '4591'
  };
  const workbench = await createMySqlProductionWorkbench({
    env,
    projectDir: root,
    logger: { log() {}, error() {} },
    workerFactory({ id, onExit }) {
      return {
        client: { createSession: async () => ({ id: `session-${id}` }), prompt: async () => ({ parts: [{ type: 'text', text: 'unused' }] }), abortSession: async () => ({}) },
        async start() { return { status: 'healthy' }; },
        async stop() { return { status: 'stopped' }; },
        async health() { return { healthy: true }; },
        snapshot() { return { status: 'healthy', endpoint: `http://127.0.0.1/${id}`, version: '1.18.25' }; },
        onExit
      };
    }
  });
  t.after(async () => {
    await workbench.stop().catch(() => {});
    const cleanup = await createMySqlDatabase({ url: testUrl, poolSize: 2 });
    try { await clearMySqlBusinessData(cleanup, { url: testUrl }); } finally { await cleanup.close(); }
    fs.rmSync(root, { recursive: true, force: true });
  });

  await bootstrapAdmin({
    db: workbench.database,
    repositoryFactory: createMySqlIdentityRepositories,
    username: 'mysql.production.admin',
    displayName: 'MySQL Production Admin',
    password: ADMIN_PASSWORD,
    idFactory: () => 'mysql-production-admin'
  });
  const address = await workbench.start(0, '127.0.0.1');
  const origin = `http://127.0.0.1:${address.port}`;
  const login = await fetch(`${origin}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'mysql.production.admin', password: ADMIN_PASSWORD })
  });
  assert.equal(login.status, 200);
  const loginHeaders = setCookies(login);
  const cookie = cookieJar(loginHeaders);
  const csrfToken = cookieValue(loginHeaders, 'workbench_csrf');
  const me = await fetch(`${origin}/api/auth/me`, { headers: { cookie } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.username, 'mysql.production.admin');
  const conversation = await fetch(`${origin}/api/conversations`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrfToken },
    body: JSON.stringify({ title: 'MySQL private conversation' })
  });
  assert.equal(conversation.status, 201);
  const body = await conversation.json();
  assert.equal(body.conversation.title, 'MySQL private conversation');
  assert.equal((await (await fetch(`${origin}/api/conversations`, { headers: { cookie } })).json()).conversations.length, 1);
});
