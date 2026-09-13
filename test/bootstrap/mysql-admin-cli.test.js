'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runAdminCli } = require('../fixtures/admin-cli');
const { createMySqlDatabase } = require('../../src/db/mysql-database');
const { resetMySqlSchema } = require('../fixtures/mysql-test-database');
const { createMySqlAuthService } = require('../../src/auth/mysql-auth-service');
const { createLoginLimiter } = require('../../src/auth/login-limiter');

function temporaryRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mysql-admin-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('production bootstrap refuses missing MySQL and never creates a SQLite database', async (t) => {
  const root = temporaryRoot(t);
  const result = await runAdminCli({ root });
  assert.equal(result.code, 1);
  assert.equal(fs.existsSync(path.join(root, 'data/workbench.db')), false);
});

test('bootstrap refuses MySQL and SQLite path mixing before creating either account', async (t) => {
  const root = temporaryRoot(t);
  const databasePath = path.join(root, 'unexpected.db');
  const result = await runAdminCli({ root, url: 'mysql://app:secret@127.0.0.1:1/test',
    env: { DATABASE_PATH: databasePath } });
  assert.equal(result.code, 1);
  assert.equal(fs.existsSync(databasePath), false);
});

test('an unavailable configured MySQL fails without falling back or exposing its credentials', async (t) => {
  const root = temporaryRoot(t);
  const url = 'mysql://app:private-test-secret@127.0.0.1:1/test';
  const result = await runAdminCli({ root, url, env: { NODE_ENV: 'development' } });
  assert.equal(result.code, 1);
  assert.equal(fs.existsSync(path.join(root, 'data/workbench.db')), false);
  assert.doesNotMatch(result.stdout + result.stderr, /private-test-secret|CLI Bootstrap 2026!/);
});

const testUrl = process.env.WORKBENCH_TEST_MYSQL_URL;
test('concurrent CLI bootstrap on fresh MySQL creates one audited administrator who can log in', { skip: !testUrl }, async (t) => {
  const root = temporaryRoot(t);
  const db = await createMySqlDatabase({ url: testUrl, poolSize: 2 });
  t.after(() => db.close());
  await resetMySqlSchema(db, { url: testUrl });
  const password = 'CLI Bootstrap 2026!';
  const results = await Promise.all(['admin.one', 'admin.two'].map((username) =>
    runAdminCli({ root, url: testUrl, username, password })));
  assert.deepEqual(results.map((r) => r.code).sort(), [0, 1]);
  assert.equal(fs.existsSync(path.join(root, 'data/workbench.db')), false);
  const users = await db.many('SELECT username FROM users');
  assert.equal(users.length, 1);
  const audits = await db.many("SELECT actor_user_id FROM audit_logs WHERE action = 'user.bootstrap_admin'");
  assert.equal(audits.length, 1);
  const service = createMySqlAuthService({ db, loginLimiter: createLoginLimiter({ maxFailures: 3, windowMs: 60000, lockMs: 60000 }) });
  const login = await service.login({ username: users[0].username, password, sourceIp: '127.0.0.1' });
  const auth = await service.authenticate(login.token);
  assert.equal(auth.user.role, 'admin');
  assert.equal(auth.user.id, audits[0].actor_user_id);
  for (const result of results) {
    assert.equal((result.stdout + result.stderr).includes(password), false);
    assert.equal((result.stdout + result.stderr).includes(testUrl), false);
  }
});
