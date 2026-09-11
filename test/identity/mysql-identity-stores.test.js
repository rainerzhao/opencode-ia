'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMySqlDatabase } = require('../../src/db/mysql-database');
const { migrateMySqlDatabase } = require('../../src/db/mysql-migrate');
const { createMySqlUserStore } = require('../../src/users/mysql-user-store');
const { createMySqlSessionStore } = require('../../src/sessions/mysql-session-store');
const { createMySqlAuditStore } = require('../../src/audit/mysql-audit-store');
const { clearMySqlBusinessData } = require('../fixtures/mysql-test-database');

const testUrl = process.env.WORKBENCH_TEST_MYSQL_URL;

test('persists users, hashed login sessions, audit events and transaction rollback on real MySQL', { skip: !testUrl }, async (t) => {
  const db = await createMySqlDatabase({ url: testUrl, poolSize: 2 });
  t.after(async () => db.close());
  await migrateMySqlDatabase(db);
  await clearMySqlBusinessData(db, { url: testUrl });

  const users = createMySqlUserStore(db);
  const sessions = createMySqlSessionStore(db);
  const audit = createMySqlAuditStore(db, { idFactory: () => 'audit-identity-1' });
  const createdAt = '2026-09-10T09:00:00.000Z';
  const user = await users.createUser({
    id: 'identity-user-1',
    username: '  Member.One  ',
    displayName: '  成员一  ',
    passwordHash: 'password-hash',
    role: 'member',
    now: createdAt
  });
  assert.deepEqual(user, {
    id: 'identity-user-1', username: 'member.one', displayName: '成员一', role: 'member',
    status: 'active', createdAt, updatedAt: createdAt, lastLoginAt: null
  });
  await assert.rejects(
    () => users.createUser({
      id: 'identity-user-2', username: 'member.one', displayName: 'Duplicate', passwordHash: 'hash',
      role: 'member', now: createdAt
    }),
    (error) => error?.code === 'USERNAME_TAKEN'
  );

  const tokenHash = 'a'.repeat(64);
  const csrfTokenHash = 'b'.repeat(64);
  const session = await sessions.createSession({
    id: 'identity-session-1', userId: user.id, tokenHash, csrfTokenHash, sessionVersion: 0,
    createdAt, expiresAt: '2026-09-10T17:00:00.000Z', sourceIp: '127.0.0.1', userAgent: 'mysql-test'
  });
  assert.equal(Object.hasOwn(session, 'token'), false);
  assert.deepEqual(await sessions.findByTokenHash(tokenHash), session);
  assert.equal(await sessions.revokeById(session.id, '2026-09-10T10:00:00.000Z'), true);
  assert.equal(await sessions.revokeById(session.id, '2026-09-10T10:01:00.000Z'), false);

  const event = await audit.append({
    actorUserId: user.id, action: 'identity.mysql_test', targetType: 'session', targetId: session.id,
    metadata: { safe: true }, sourceIp: '127.0.0.1', now: createdAt
  });
  assert.deepEqual(event.metadata, { safe: true });
  assert.equal((await audit.list({ limit: 10 }))[0].id, event.id);

  await assert.rejects(
    () => db.transaction(async (tx) => {
      const txUsers = createMySqlUserStore(tx);
      await txUsers.createUser({
        id: 'identity-rolled-back', username: 'rollback.user', displayName: 'Rollback', passwordHash: 'hash',
        role: 'member', now: createdAt
      });
      throw new Error('force rollback');
    }),
    /force rollback/
  );
  assert.equal(await users.findById('identity-rolled-back'), null);
});
