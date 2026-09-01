'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../../src/db/open-database');
const { migrateDatabase } = require('../../src/db/migrate');
const { createUserStore } = require('../../src/users/user-store');
const { createSessionStore } = require('../../src/sessions/session-store');

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-session-store-test-'));
  const db = openDatabase({ filename: path.join(root, 'workbench.db') });
  migrateDatabase(db);
  t.after(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  createUserStore(db).createUser({
    id: 'user-1',
    username: 'member.one',
    displayName: 'Member One',
    passwordHash: 'stored-password-hash',
    role: 'member',
    now: '2026-09-01T08:00:00.000Z'
  });
  return { db, store: createSessionStore(db) };
}

test('stores only token hashes and finds an active session by its hash', (t) => {
  const { db, store } = setup(t);
  const tokenHash = 'a'.repeat(64);
  const csrfTokenHash = 'b'.repeat(64);
  const session = store.createSession({
    id: 'session-1',
    userId: 'user-1',
    tokenHash,
    csrfTokenHash,
    sessionVersion: 0,
    createdAt: '2026-09-01T08:00:00.000Z',
    expiresAt: '2026-09-02T08:00:00.000Z',
    sourceIp: '127.0.0.1',
    userAgent: 'test-agent'
  });

  assert.equal(Object.hasOwn(session, 'token'), false);
  assert.deepEqual(store.findByTokenHash(tokenHash), {
    id: 'session-1',
    userId: 'user-1',
    tokenHash,
    csrfTokenHash,
    sessionVersion: 0,
    createdAt: '2026-09-01T08:00:00.000Z',
    lastSeenAt: '2026-09-01T08:00:00.000Z',
    expiresAt: '2026-09-02T08:00:00.000Z',
    revokedAt: null,
    sourceIp: '127.0.0.1',
    userAgent: 'test-agent'
  });
  const stored = db.prepare('SELECT token_hash, csrf_token_hash FROM login_sessions WHERE id = ?').get('session-1');
  assert.deepEqual({ ...stored }, { token_hash: tokenHash, csrf_token_hash: csrfTokenHash });
});

test('revokes one session or every active session for a user idempotently', (t) => {
  const { store } = setup(t);
  const base = {
    userId: 'user-1',
    csrfTokenHash: 'c'.repeat(64),
    sessionVersion: 0,
    createdAt: '2026-09-01T08:00:00.000Z',
    expiresAt: '2026-09-02T08:00:00.000Z'
  };
  store.createSession({ ...base, id: 'session-1', tokenHash: '1'.repeat(64) });
  store.createSession({ ...base, id: 'session-2', tokenHash: '2'.repeat(64) });

  assert.equal(store.revokeById('session-1', '2026-09-01T09:00:00.000Z'), true);
  assert.equal(store.revokeById('session-1', '2026-09-01T09:01:00.000Z'), false);
  assert.equal(store.revokeForUser('user-1', '2026-09-01T10:00:00.000Z'), 1);
  assert.equal(store.findByTokenHash('1'.repeat(64)).revokedAt, '2026-09-01T09:00:00.000Z');
  assert.equal(store.findByTokenHash('2'.repeat(64)).revokedAt, '2026-09-01T10:00:00.000Z');
});
