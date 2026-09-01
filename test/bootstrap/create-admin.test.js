'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../../src/db/open-database');
const { migrateDatabase } = require('../../src/db/migrate');
const { verifyPassword } = require('../../src/auth/password');
const { createUserStore } = require('../../src/users/user-store');
const { createAuditStore } = require('../../src/audit/audit-store');
const { bootstrapAdmin } = require('../../src/bootstrap/bootstrap-admin');

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-bootstrap-test-'));
  const db = openDatabase({ filename: path.join(root, 'workbench.db') });
  migrateDatabase(db);
  t.after(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    db,
    userStore: createUserStore(db),
    auditStore: createAuditStore(db)
  };
}

test('creates the only bootstrap administrator with a normalized username and an audit record', async (t) => {
  const { db, userStore, auditStore } = setup(t);
  const createdAt = '2026-09-01T08:00:00.000Z';
  const password = 'Bootstrap Admin 2026!';

  const admin = await bootstrapAdmin({
    db,
    username: '  Admin.User  ',
    displayName: '  首位管理员  ',
    password,
    now: () => createdAt,
    idFactory: () => 'user-admin-1'
  });

  assert.deepEqual(admin, {
    id: 'user-admin-1',
    username: 'admin.user',
    displayName: '首位管理员',
    role: 'admin',
    status: 'active',
    createdAt,
    updatedAt: createdAt,
    lastLoginAt: null
  });
  assert.equal(Object.hasOwn(admin, 'passwordHash'), false);

  const stored = db.prepare('SELECT username, password_hash FROM users WHERE id = ?').get(admin.id);
  assert.equal(stored.username, 'admin.user');
  assert.notEqual(stored.password_hash, password);
  assert.equal(await verifyPassword(password, stored.password_hash), true);
  assert.equal(userStore.countUsers(), 1);

  const audit = auditStore.list({ limit: 10 });
  assert.equal(audit.length, 1);
  assert.deepEqual(audit[0], {
    id: audit[0].id,
    actorUserId: admin.id,
    action: 'user.bootstrap_admin',
    targetType: 'user',
    targetId: admin.id,
    metadata: { role: 'admin', username: 'admin.user' },
    sourceIp: null,
    createdAt
  });
});

test('refuses bootstrap when any user already exists', async (t) => {
  const { db, userStore } = setup(t);
  const input = {
    db,
    username: 'admin',
    displayName: 'Administrator',
    password: 'Bootstrap Admin 2026!',
    now: () => '2026-09-01T08:00:00.000Z'
  };

  await bootstrapAdmin(input);
  await assert.rejects(
    bootstrapAdmin({ ...input, username: 'second-admin' }),
    (error) => error.code === 'BOOTSTRAP_ALREADY_COMPLETE'
  );
  assert.equal(userStore.countUsers(), 1);
});

test('rejects invalid usernames and display names before writing data', async (t) => {
  const { db, userStore } = setup(t);
  const base = {
    db,
    password: 'Bootstrap Admin 2026!',
    now: () => '2026-09-01T08:00:00.000Z'
  };

  await assert.rejects(
    bootstrapAdmin({ ...base, username: '../admin', displayName: 'Admin' }),
    (error) => error.code === 'INVALID_USERNAME'
  );
  await assert.rejects(
    bootstrapAdmin({ ...base, username: 'admin', displayName: '   ' }),
    (error) => error.code === 'INVALID_DISPLAY_NAME'
  );
  await assert.rejects(
    bootstrapAdmin({ ...base, username: 'admin', displayName: 'Admin\nInjected' }),
    (error) => error.code === 'INVALID_DISPLAY_NAME'
  );
  assert.equal(userStore.countUsers(), 0);
});
