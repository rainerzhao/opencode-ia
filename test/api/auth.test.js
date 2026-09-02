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

function getSetCookies(response) {
  return typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
}

function cookieJar(setCookies) {
  return setCookies.map((header) => header.split(';', 1)[0]).join('; ');
}

function cookieValue(setCookies, name) {
  const prefix = `${name}=`;
  const pair = setCookies.map((header) => header.split(';', 1)[0]).find((item) => item.startsWith(prefix));
  return pair ? decodeURIComponent(pair.slice(prefix.length)) : null;
}

async function json(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function setup(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-auth-api-test-'));
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
    loginLockSeconds: 900,
    ...overrides
  };
  for (const directory of [
    config.knowledgeDir,
    config.solutionsDir,
    config.skillsDir,
    config.uploadTempDir
  ]) fs.mkdirSync(directory, { recursive: true });
  const workbench = createWorkbenchServer({
    config,
    database: db,
    promptRunner: { runPrompt: async () => ({ text: 'unused', events: [], stderr: '' }) },
    logger: { log() {}, error() {} }
  });
  const address = await workbench.start(0, '127.0.0.1');
  const origin = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await workbench.stop().catch(() => {});
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { origin, db };
}

async function login(origin, username, password) {
  const response = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const body = await json(response);
  const setCookies = getSetCookies(response);
  return {
    response,
    body,
    setCookies,
    cookie: cookieJar(setCookies),
    csrfToken: cookieValue(setCookies, 'workbench_csrf')
  };
}

test('logs in, exposes current user without a JS session token, enforces CSRF, and logs out', async (t) => {
  const { origin } = await setup(t);
  const anonymous = await fetch(`${origin}/api/auth/me`);
  assert.equal(anonymous.status, 401);
  assert.equal((await json(anonymous)).error.code, 'SESSION_INVALID');

  const missing = await login(origin, 'missing', 'Wrong Password 2026!');
  const wrong = await login(origin, 'admin', 'Wrong Password 2026!');
  assert.equal(missing.response.status, 401);
  assert.equal(wrong.response.status, 401);
  assert.equal(missing.body.error.message, wrong.body.error.message);

  const authenticated = await login(origin, 'admin', 'Admin Password 2026!');
  assert.equal(authenticated.response.status, 200);
  assert.equal(authenticated.body.user.username, 'admin');
  assert.equal(Object.hasOwn(authenticated.body, 'token'), false);
  assert.equal(Object.hasOwn(authenticated.body.user, 'passwordHash'), false);
  assert.equal(authenticated.setCookies.length, 2);
  assert.match(authenticated.setCookies[0], /HttpOnly/);
  assert.doesNotMatch(authenticated.setCookies[1], /HttpOnly/);
  assert.doesNotMatch(authenticated.setCookies.join('\n'), /Secure/);
  assert.match(authenticated.csrfToken, /^[A-Za-z0-9_-]{43}$/);

  const me = await fetch(`${origin}/api/auth/me`, {
    headers: { cookie: authenticated.cookie }
  });
  assert.equal(me.status, 200);
  assert.equal(me.headers.get('cache-control'), 'no-store');
  assert.equal((await json(me)).user.role, 'admin');

  const missingCsrf = await fetch(`${origin}/api/auth/logout`, {
    method: 'POST',
    headers: { cookie: authenticated.cookie }
  });
  assert.equal(missingCsrf.status, 403);
  assert.equal((await json(missingCsrf)).error.code, 'CSRF_INVALID');

  const logout = await fetch(`${origin}/api/auth/logout`, {
    method: 'POST',
    headers: {
      cookie: authenticated.cookie,
      'x-csrf-token': authenticated.csrfToken
    }
  });
  assert.equal(logout.status, 204);
  assert.equal(getSetCookies(logout).every((header) => header.includes('Max-Age=0')), true);

  const afterLogout = await fetch(`${origin}/api/auth/me`, {
    headers: { cookie: authenticated.cookie }
  });
  assert.equal(afterLogout.status, 401);
});

test('allows an admin to create and list members while denying member administration', async (t) => {
  const { origin } = await setup(t);
  const admin = await login(origin, 'admin', 'Admin Password 2026!');
  const create = await fetch(`${origin}/api/admin/users`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: admin.cookie,
      'x-csrf-token': admin.csrfToken
    },
    body: JSON.stringify({
      username: 'member.one',
      displayName: 'Member One',
      password: 'Member Password 2026!',
      role: 'member'
    })
  });
  assert.equal(create.status, 201, JSON.stringify(await create.clone().text()));
  const member = (await json(create)).user;
  assert.equal(member.role, 'member');

  const list = await fetch(`${origin}/api/admin/users`, {
    headers: { cookie: admin.cookie }
  });
  assert.equal(list.status, 200);
  assert.equal(list.headers.get('cache-control'), 'no-store');
  assert.equal((await json(list)).users.length, 2);

  const memberLogin = await login(origin, 'member.one', 'Member Password 2026!');
  const forbidden = await fetch(`${origin}/api/admin/users`, {
    headers: { cookie: memberLogin.cookie }
  });
  assert.equal(forbidden.status, 403);
  assert.equal((await json(forbidden)).error.code, 'FORBIDDEN');
});

test('changes a password only with CSRF and revokes the current session', async (t) => {
  const { origin } = await setup(t);
  const admin = await login(origin, 'admin', 'Admin Password 2026!');
  const changed = await fetch(`${origin}/api/auth/change-password`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: admin.cookie,
      'x-csrf-token': admin.csrfToken
    },
    body: JSON.stringify({
      currentPassword: 'Admin Password 2026!',
      newPassword: 'Changed Admin Password 2026!'
    })
  });
  assert.equal(changed.status, 204);
  const oldSession = await fetch(`${origin}/api/auth/me`, { headers: { cookie: admin.cookie } });
  assert.equal(oldSession.status, 401);
  assert.equal((await login(origin, 'admin', 'Admin Password 2026!')).response.status, 401);
  assert.equal((await login(origin, 'admin', 'Changed Admin Password 2026!')).response.status, 200);
});

test('marks authentication cookies Secure when configured for production transport', async (t) => {
  const { origin } = await setup(t, { cookieSecure: true });
  const authenticated = await login(origin, 'admin', 'Admin Password 2026!');

  assert.equal(authenticated.response.status, 200);
  assert.equal(authenticated.setCookies.length, 2);
  assert.equal(authenticated.setCookies.every((header) => /; Secure(?:;|$)/.test(header)), true);
});

test('rejects an expired persisted session at the HTTP boundary', async (t) => {
  const { origin, db } = await setup(t);
  const authenticated = await login(origin, 'admin', 'Admin Password 2026!');
  db.prepare('UPDATE login_sessions SET expires_at = ?').run('2000-01-01T00:00:00.000Z');

  const response = await fetch(`${origin}/api/auth/me`, {
    headers: { cookie: authenticated.cookie }
  });
  assert.equal(response.status, 401);
  assert.equal((await json(response)).error.code, 'SESSION_INVALID');
});

test('rate limits repeated login failures by account and exposes a retry interval', async (t) => {
  const { origin } = await setup(t, { loginMaxFailures: 2 });
  assert.equal((await login(origin, 'admin', 'Wrong Password 2026!')).response.status, 401);
  assert.equal((await login(origin, 'admin', 'Wrong Password 2026!')).response.status, 401);

  const blocked = await login(origin, 'admin', 'Admin Password 2026!');
  assert.equal(blocked.response.status, 429);
  assert.match(blocked.response.headers.get('retry-after'), /^\d+$/);
  assert.equal(blocked.body.error.code, 'LOGIN_RATE_LIMITED');
});
