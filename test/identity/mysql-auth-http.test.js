'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { createMySqlDatabase } = require('../../src/db/mysql-database');
const { migrateMySqlDatabase } = require('../../src/db/mysql-migrate');
const { createMySqlIdentityRepositories } = require('../../src/auth/mysql-identity-repositories');
const { createMySqlAuthService } = require('../../src/auth/mysql-auth-service');
const { createLoginLimiter } = require('../../src/auth/login-limiter');
const { createAuthMiddleware } = require('../../src/auth/auth-middleware');
const { createAuthRouter } = require('../../src/modules/auth/routes');
const { createUserAdminRouter } = require('../../src/modules/users/routes');
const { bootstrapAdmin } = require('../../src/bootstrap/bootstrap-admin');

const testUrl = process.env.WORKBENCH_TEST_MYSQL_URL;

function cookies(response) {
  return typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
}

function cookieJar(headers) { return headers.map((header) => header.split(';', 1)[0]).join('; '); }

function csrfCookie(headers) {
  const pair = headers.map((header) => header.split(';', 1)[0]).find((value) => value.startsWith('workbench_csrf='));
  return pair ? decodeURIComponent(pair.slice('workbench_csrf='.length)) : null;
}

test('serves login Cookie, authenticated profile and CSRF-protected user administration through async MySQL auth', { skip: !testUrl }, async (t) => {
  const db = await createMySqlDatabase({ url: testUrl, poolSize: 2 });
  t.after(async () => db.close());
  await migrateMySqlDatabase(db);
  await bootstrapAdmin({
    db, repositoryFactory: createMySqlIdentityRepositories, username: 'admin', displayName: 'Administrator',
    password: 'Admin Password 2026!', idFactory: () => 'http-mysql-admin'
  });
  const authService = createMySqlAuthService({
    db, repositoryFactory: createMySqlIdentityRepositories,
    loginLimiter: createLoginLimiter({ maxFailures: 3, windowMs: 60_000, lockMs: 60_000 })
  });
  const authMiddleware = createAuthMiddleware({ authService });
  const app = express();
  app.use(express.json());
  app.use('/api/auth', createAuthRouter({
    authService, authMiddleware, config: { cookieSecure: false, sessionTtlSeconds: 3600 }
  }));
  app.use('/api/admin/users', createUserAdminRouter({ authService, authMiddleware }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: { code: error.code || 'INTERNAL' } }));
  const server = http.createServer(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;

  const login = await fetch(`${origin}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'Admin Password 2026!' })
  });
  assert.equal(login.status, 200);
  const loginCookies = cookies(login);
  const cookie = cookieJar(loginCookies);
  const csrfToken = csrfCookie(loginCookies);
  assert.match(csrfToken, /^[A-Za-z0-9_-]{43}$/);
  const me = await fetch(`${origin}/api/auth/me`, { headers: { cookie } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.username, 'admin');
  const created = await fetch(`${origin}/api/admin/users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrfToken },
    body: JSON.stringify({ username: 'mysql.member', displayName: 'MySQL Member', password: 'Member Password 2026!', role: 'member' })
  });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).user.username, 'mysql.member');
});
