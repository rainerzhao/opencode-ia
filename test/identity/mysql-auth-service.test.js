'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMySqlDatabase } = require('../../src/db/mysql-database');
const { migrateMySqlDatabase } = require('../../src/db/mysql-migrate');
const { createMySqlIdentityRepositories } = require('../../src/auth/mysql-identity-repositories');
const { bootstrapAdmin } = require('../../src/bootstrap/bootstrap-admin');
const { createLoginLimiter } = require('../../src/auth/login-limiter');
const { createMySqlAuthService } = require('../../src/auth/mysql-auth-service');
const { clearMySqlBusinessData } = require('../fixtures/mysql-test-database');

const testUrl = process.env.WORKBENCH_TEST_MYSQL_URL;

test('uses async MySQL repositories for bootstrap, login, session invalidation and audit', { skip: !testUrl }, async (t) => {
  const db = await createMySqlDatabase({ url: testUrl, poolSize: 2 });
  t.after(async () => db.close());
  await migrateMySqlDatabase(db);
  await clearMySqlBusinessData(db, { url: testUrl });
  let now = new Date('2026-09-10T09:00:00.000Z');
  let ids = 0;
  await bootstrapAdmin({
    db, repositoryFactory: createMySqlIdentityRepositories, username: 'admin', displayName: 'Administrator',
    password: 'Admin Password 2026!', now: () => now.toISOString(), idFactory: () => 'mysql-admin'
  });
  const service = createMySqlAuthService({
    db, repositoryFactory: createMySqlIdentityRepositories,
    loginLimiter: createLoginLimiter({ maxFailures: 3, windowMs: 60_000, lockMs: 60_000, now: () => now.getTime() }),
    clock: () => new Date(now), idFactory: () => `mysql-auth-${++ids}`
  });

  const login = await service.login({ username: 'admin', password: 'Admin Password 2026!', sourceIp: '127.0.0.1' });
  const auth = await service.authenticate(login.token);
  assert.equal(auth.user.id, 'mysql-admin');
  await service.changePassword({
    auth, currentPassword: 'Admin Password 2026!', newPassword: 'Changed Admin Password 2026!', sourceIp: '127.0.0.1'
  });
  await assert.rejects(() => service.authenticate(login.token), (error) => error?.code === 'SESSION_INVALID');
  await assert.rejects(
    () => service.login({ username: 'admin', password: 'Admin Password 2026!', sourceIp: '127.0.0.1' }),
    (error) => error?.code === 'INVALID_CREDENTIALS'
  );
  const second = await service.login({ username: 'admin', password: 'Changed Admin Password 2026!', sourceIp: '127.0.0.1' });
  assert.equal((await service.authenticate(second.token)).user.username, 'admin');
});
