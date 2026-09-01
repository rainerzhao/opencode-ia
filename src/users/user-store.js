'use strict';

function createError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeUsername(username) {
  if (typeof username !== 'string') throw createError('INVALID_USERNAME', 'username is invalid');
  const normalized = username.trim().toLowerCase();
  if (!/^[a-z][a-z0-9._-]{2,31}$/.test(normalized)) {
    throw createError('INVALID_USERNAME', 'username is invalid');
  }
  return normalized;
}

function normalizeDisplayName(displayName) {
  if (typeof displayName !== 'string') {
    throw createError('INVALID_DISPLAY_NAME', 'display name is invalid');
  }
  const normalized = displayName.trim();
  const length = Array.from(normalized).length;
  if (length < 1 || length > 80 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw createError('INVALID_DISPLAY_NAME', 'display name is invalid');
  }
  return normalized;
}

function toPublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at
  };
}

function toAuthUser(row) {
  if (!row) return null;
  return {
    ...toPublicUser(row),
    passwordHash: row.password_hash,
    sessionVersion: row.session_version
  };
}

function createUserStore(db) {
  const countStatement = db.prepare('SELECT COUNT(*) AS count FROM users');
  const insertStatement = db.prepare(`
    INSERT INTO users (
      id, username, display_name, password_hash, role, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const byIdStatement = db.prepare('SELECT * FROM users WHERE id = ?');
  const byUsernameStatement = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE');
  const listStatement = db.prepare('SELECT * FROM users ORDER BY username LIMIT ? OFFSET ?');

  function countUsers() {
    return countStatement.get().count;
  }

  function createUser({ id, username, displayName, passwordHash, role, status = 'active', now }) {
    const normalizedUsername = normalizeUsername(username);
    const normalizedDisplayName = normalizeDisplayName(displayName);
    if (typeof id !== 'string' || id === '') throw createError('INVALID_USER_ID', 'user id is invalid');
    if (typeof passwordHash !== 'string' || passwordHash === '') {
      throw createError('INVALID_PASSWORD_HASH', 'password hash is invalid');
    }
    if (role !== 'admin' && role !== 'member') throw createError('INVALID_ROLE', 'role is invalid');
    if (status !== 'active' && status !== 'disabled') {
      throw createError('INVALID_USER_STATUS', 'user status is invalid');
    }
    if (typeof now !== 'string' || now === '') throw createError('INVALID_TIMESTAMP', 'timestamp is invalid');

    try {
      insertStatement.run(
        id,
        normalizedUsername,
        normalizedDisplayName,
        passwordHash,
        role,
        status,
        now,
        now
      );
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw createError('USERNAME_TAKEN', 'username is already in use');
      }
      throw error;
    }
    return toPublicUser(byIdStatement.get(id));
  }

  function findById(id) {
    return toPublicUser(byIdStatement.get(id));
  }

  function findByUsername(username) {
    let normalized;
    try {
      normalized = normalizeUsername(username);
    } catch {
      return null;
    }
    return toAuthUser(byUsernameStatement.get(normalized));
  }

  function listUsers({ limit = 100, offset = 0 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw createError('INVALID_LIMIT', 'limit is invalid');
    }
    if (!Number.isInteger(offset) || offset < 0) {
      throw createError('INVALID_OFFSET', 'offset is invalid');
    }
    return listStatement.all(limit, offset).map(toPublicUser);
  }

  return { countUsers, createUser, findById, findByUsername, listUsers };
}

module.exports = { createUserStore, normalizeUsername, normalizeDisplayName };
