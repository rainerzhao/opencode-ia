'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../../src/db/open-database');
const { migrateDatabase } = require('../../src/db/migrate');
const { bootstrapAdmin } = require('../../src/bootstrap/bootstrap-admin');
const { createWorkbenchServer } = require('../../src/create-workbench-server');

function setCookies(response) {
  return response.headers.getSetCookie();
}

function cookieJar(headers) {
  return headers.map((header) => header.split(';', 1)[0]).join('; ');
}

function cookieValue(headers, name) {
  const prefix = `${name}=`;
  const pair = headers.map((header) => header.split(';', 1)[0]).find((item) => item.startsWith(prefix));
  return pair ? decodeURIComponent(pair.slice(prefix.length)) : null;
}

async function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-user-admin-api-test-'));
  const databasePath = path.join(root, 'workbench.db');
  const db = openDatabase({ filename: databasePath });
  migrateDatabase(db);
  await bootstrapAdmin({
    db,
    username: 'admin',
    displayName: 'Administrator',
    password: 'Admin Password 2026!',
    idFactory: () => 'user-admin'
  });
  const config = {
    projectDir: path.resolve(__dirname, '../..'),
    port: 0,
    maxSessions: 2,
    opencodeCwd: root,
    knowledgeDir: path.join(root, 'knowledge'),
    solutionsDir: path.join(root, 'solutions'),
    skillsDir: path.join(root, 'skills'),
    uploadTempDir: path.join(root, 'uploads'),
    fetchAllowedHosts: [],
    databasePath,
    cookieSecure: false,
    sessionTtlSeconds: 3600,
    loginMaxFailures: 5,
    loginWindowSeconds: 900,
    loginLockSeconds: 900
  };
  for (const directory of [config.knowledgeDir, config.solutionsDir, config.skillsDir, config.uploadTempDir]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  const workbench = createWorkbenchServer({
    config,
    database: db,
    promptRunner: { runPrompt: async () => ({ text: 'unused', events: [], stderr: '' }) },
    logger: { log() {}, error() {} }
  });
  const address = await workbench.start(0, '127.0.0.1');
  t.after(async () => {
    await workbench.stop().catch(() => {});
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { origin: `http://127.0.0.1:${address.port}` };
}

async function login(origin, username, password) {
  const response = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const headers = setCookies(response);
  return {
    response,
    cookie: cookieJar(headers),
    csrf: cookieValue(headers, 'workbench_csrf')
  };
}

async function createMember(origin, admin) {
  const response = await fetch(`${origin}/api/admin/users`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: admin.cookie,
      'x-csrf-token': admin.csrf
    },
    body: JSON.stringify({
      username: 'member.one',
      displayName: 'Member One',
      password: 'Member Password 2026!',
      role: 'member'
    })
  });
  return { response, user: (await response.json()).user };
}

test('admin resets passwords, changes account status, and revokes sessions with CSRF protection', async (t) => {
  const { origin } = await setup(t);
  const admin = await login(origin, 'admin', 'Admin Password 2026!');
  const created = await createMember(origin, admin);
  assert.equal(created.response.status, 201);
  const member = await login(origin, 'member.one', 'Member Password 2026!');
  assert.equal(member.response.status, 200);

  const missingCsrf = await fetch(`${origin}/api/admin/users/${created.user.id}/sessions/revoke`, {
    method: 'POST',
    headers: { cookie: admin.cookie }
  });
  assert.equal(missingCsrf.status, 403);

  const revoked = await fetch(`${origin}/api/admin/users/${created.user.id}/sessions/revoke`, {
    method: 'POST',
    headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrf }
  });
  assert.equal(revoked.status, 204);
  assert.equal((await fetch(`${origin}/api/auth/me`, { headers: { cookie: member.cookie } })).status, 401);

  const reset = await fetch(`${origin}/api/admin/users/${created.user.id}/password`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      cookie: admin.cookie,
      'x-csrf-token': admin.csrf
    },
    body: JSON.stringify({ newPassword: 'Reset Member Password 2026!' })
  });
  assert.equal(reset.status, 204);
  assert.equal((await login(origin, 'member.one', 'Reset Member Password 2026!')).response.status, 200);

  const disabled = await fetch(`${origin}/api/admin/users/${created.user.id}/status`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      cookie: admin.cookie,
      'x-csrf-token': admin.csrf
    },
    body: JSON.stringify({ status: 'disabled' })
  });
  assert.equal(disabled.status, 200);
  assert.equal((await disabled.json()).user.status, 'disabled');
  assert.equal((await login(origin, 'member.one', 'Reset Member Password 2026!')).response.status, 401);
});
