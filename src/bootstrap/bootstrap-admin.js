'use strict';

const crypto = require('node:crypto');
const { hashPassword } = require('../auth/password');
const { createUserStore, normalizeUsername, normalizeDisplayName } = require('../users/user-store');
const { createAuditStore } = require('../audit/audit-store');

async function bootstrapAdmin({
  db,
  username,
  displayName,
  password,
  now = () => new Date().toISOString(),
  idFactory = crypto.randomUUID
}) {
  if (!db) throw new TypeError('database is required');
  const normalizedUsername = normalizeUsername(username);
  const normalizedDisplayName = normalizeDisplayName(displayName);
  const passwordHash = await hashPassword(password);
  const userStore = createUserStore(db);
  const auditStore = createAuditStore(db);
  const timestamp = now();
  const id = idFactory();

  db.exec('BEGIN IMMEDIATE;');
  try {
    if (userStore.countUsers() !== 0) {
      const error = new Error('administrator bootstrap has already been completed');
      error.code = 'BOOTSTRAP_ALREADY_COMPLETE';
      throw error;
    }
    const user = userStore.createUser({
      id,
      username: normalizedUsername,
      displayName: normalizedDisplayName,
      passwordHash,
      role: 'admin',
      now: timestamp
    });
    auditStore.append({
      actorUserId: user.id,
      action: 'user.bootstrap_admin',
      targetType: 'user',
      targetId: user.id,
      metadata: { role: user.role, username: user.username },
      now: timestamp
    });
    db.exec('COMMIT;');
    return user;
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

module.exports = { bootstrapAdmin };
