'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../../src/db/open-database');
const { migrateDatabase } = require('../../src/db/migrate');
const { bootstrapAdmin } = require('../../src/bootstrap/bootstrap-admin');
const { createLoginLimiter } = require('../../src/auth/login-limiter');
const { createAuthService } = require('../../src/auth/auth-service');
const { createAuditStore } = require('../../src/audit/audit-store');

async function setup(t, { maxFailures = 3, sessionTtlSeconds = 3600 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-auth-service-test-'));
  const db = openDatabase({ filename: path.join(root, 'workbench.db') });
  migrateDatabase(db);
  t.after(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  let current = new Date('2026-09-01T08:00:00.000Z');
  let nextId = 0;
  await bootstrapAdmin({
    db,
    username: 'admin',
    displayName: 'Administrator',
    password: 'Admin Password 2026!',
    now: () => current.toISOString(),
    idFactory: () => 'user-admin'
  });
  const limiter = createLoginLimiter({
    maxFailures,
    windowMs: 60_000,
    lockMs: 120_000,
    now: () => current.getTime()
  });
  const service = createAuthService({
    db,
    loginLimiter: limiter,
    sessionTtlSeconds,
    clock: () => new Date(current),
    idFactory: () => `generated-${++nextId}`
  });
  return {
    db,
    service,
    limiter,
    auditStore: createAuditStore(db),
    advance(ms) { current = new Date(current.getTime() + ms); }
  };
}

async function expectCode(promise, code, status) {
  await assert.rejects(promise, (error) => error.code === code && error.status === status);
}

test('logs in with opaque credentials, persists only hashes, and authenticates the active session', async (t) => {
  const { db, service, auditStore } = await setup(t);
  const login = await service.login({
    username: ' ADMIN ',
    password: 'Admin Password 2026!',
    sourceIp: '127.0.0.1',
    userAgent: 'auth-service-test'
  });

  assert.equal(login.user.username, 'admin');
  assert.equal(login.user.role, 'admin');
  assert.match(login.token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(login.csrfToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(login.expiresAt, '2026-09-01T09:00:00.000Z');
  assert.equal(Object.hasOwn(login.user, 'passwordHash'), false);

  const stored = db.prepare('SELECT token_hash, csrf_token_hash FROM login_sessions').get();
  assert.notEqual(stored.token_hash, login.token);
  assert.notEqual(stored.csrf_token_hash, login.csrfToken);
  assert.equal(JSON.stringify(stored).includes(login.token), false);

  const authenticated = service.authenticate(login.token);
  assert.equal(authenticated.user.id, 'user-admin');
  assert.equal(authenticated.session.id, login.sessionId);
  assert.equal(authenticated.session.csrfTokenHash, stored.csrf_token_hash);
  assert.equal(auditStore.list({ limit: 10 }).some((event) => event.action === 'auth.login'), true);
});

test('returns one generic error for unknown, wrong-password, and disabled accounts, then rate limits', async (t) => {
  const { service } = await setup(t, { maxFailures: 3 });
  await expectCode(
    service.login({ username: 'missing', password: 'Wrong Password 2026!', sourceIp: '10.0.0.1' }),
    'INVALID_CREDENTIALS',
    401
  );
  await expectCode(
    service.login({ username: 'admin', password: 'Wrong Password 2026!', sourceIp: '10.0.0.2' }),
    'INVALID_CREDENTIALS',
    401
  );
  await expectCode(
    service.login({ username: 'admin', password: 'Wrong Password 2026!', sourceIp: '10.0.0.3' }),
    'INVALID_CREDENTIALS',
    401
  );
  await expectCode(
    service.login({ username: 'admin', password: 'Wrong Password 2026!', sourceIp: '10.0.0.4' }),
    'INVALID_CREDENTIALS',
    401
  );
  await expectCode(
    service.login({ username: 'admin', password: 'Admin Password 2026!', sourceIp: '10.0.0.5' }),
    'LOGIN_RATE_LIMITED',
    429
  );
});

test('rejects expired, revoked, malformed, and password-invalidated sessions', async (t) => {
  const fixture = await setup(t, { sessionTtlSeconds: 60 });
  const first = await fixture.service.login({
    username: 'admin',
    password: 'Admin Password 2026!',
    sourceIp: '127.0.0.1'
  });
  await fixture.service.logout({ token: first.token, sourceIp: '127.0.0.1' });
  assert.throws(() => fixture.service.authenticate(first.token), (error) => error.code === 'SESSION_INVALID');
  assert.throws(() => fixture.service.authenticate('malformed'), (error) => error.code === 'SESSION_INVALID');

  const second = await fixture.service.login({
    username: 'admin',
    password: 'Admin Password 2026!',
    sourceIp: '127.0.0.1'
  });
  fixture.advance(60_001);
  assert.throws(() => fixture.service.authenticate(second.token), (error) => error.code === 'SESSION_INVALID');

  fixture.advance(-60_001);
  const third = await fixture.service.login({
    username: 'admin',
    password: 'Admin Password 2026!',
    sourceIp: '127.0.0.1'
  });
  const auth = fixture.service.authenticate(third.token);
  await fixture.service.changePassword({
    auth,
    currentPassword: 'Admin Password 2026!',
    newPassword: 'New Admin Password 2026!',
    sourceIp: '127.0.0.1'
  });
  assert.throws(() => fixture.service.authenticate(third.token), (error) => error.code === 'SESSION_INVALID');
  await expectCode(
    fixture.service.login({ username: 'admin', password: 'Admin Password 2026!', sourceIp: '127.0.0.1' }),
    'INVALID_CREDENTIALS',
    401
  );
  await assert.doesNotReject(
    fixture.service.login({ username: 'admin', password: 'New Admin Password 2026!', sourceIp: '127.0.0.1' })
  );
});

test('allows admins to create, reset, disable, list, and revoke members while denying member administration', async (t) => {
  const { service } = await setup(t);
  const adminLogin = await service.login({
    username: 'admin',
    password: 'Admin Password 2026!',
    sourceIp: '127.0.0.1'
  });
  const adminAuth = service.authenticate(adminLogin.token);
  const member = await service.createUser({
    actor: adminAuth,
    username: 'member.one',
    displayName: 'Member One',
    password: 'Member Password 2026!',
    role: 'member',
    sourceIp: '127.0.0.1'
  });
  assert.equal(member.role, 'member');
  assert.equal(service.listUsers({ actor: adminAuth }).length, 2);

  const memberLogin = await service.login({
    username: 'member.one',
    password: 'Member Password 2026!',
    sourceIp: '127.0.0.2'
  });
  const memberAuth = service.authenticate(memberLogin.token);
  await expectCode(
    service.createUser({
      actor: memberAuth,
      username: 'forbidden',
      displayName: 'Forbidden',
      password: 'Forbidden Password 2026!',
      role: 'member'
    }),
    'FORBIDDEN',
    403
  );

  await service.resetPassword({
    actor: adminAuth,
    targetUserId: member.id,
    newPassword: 'Reset Member Password 2026!',
    sourceIp: '127.0.0.1'
  });
  assert.throws(() => service.authenticate(memberLogin.token), (error) => error.code === 'SESSION_INVALID');
  const resetLogin = await service.login({
    username: 'member.one',
    password: 'Reset Member Password 2026!',
    sourceIp: '127.0.0.2'
  });
  await service.setUserStatus({
    actor: adminAuth,
    targetUserId: member.id,
    status: 'disabled',
    sourceIp: '127.0.0.1'
  });
  assert.throws(() => service.authenticate(resetLogin.token), (error) => error.code === 'SESSION_INVALID');
  await expectCode(
    service.login({ username: 'member.one', password: 'Reset Member Password 2026!', sourceIp: '127.0.0.2' }),
    'INVALID_CREDENTIALS',
    401
  );
});
