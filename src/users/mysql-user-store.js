'use strict';

const { normalizeUsername, normalizeDisplayName } = require('./user-store');

function createError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function toIsoTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return value;
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(value)) return value;
  const [whole, fraction = ''] = value.split('.');
  return `${whole.replace(' ', 'T')}.${fraction.padEnd(3, '0')}Z`;
}

function toMySqlTimestamp(value) {
  if (typeof value !== 'string') return value;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
    ? value.slice(0, -1).replace('T', ' ')
    : value;
}

function toPublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
    lastLoginAt: toIsoTimestamp(row.last_login_at)
  };
}

function toAuthUser(row) {
  if (!row) return null;
  return {
    ...toPublicUser(row),
    passwordHash: row.password_hash,
    sessionVersion: Number(row.session_version)
  };
}

function requireDatabase(db) {
  if (!db || typeof db.query !== 'function' || typeof db.one !== 'function' || typeof db.many !== 'function') {
    throw new TypeError('MySQL database is required');
  }
}

function createMySqlUserStore(db) {
  requireDatabase(db);

  async function countUsers() {
    const row = await db.one('SELECT COUNT(*) AS count FROM users');
    return Number(row?.count || 0);
  }

  async function createUser({ id, username, displayName, passwordHash, role, status = 'active', now }) {
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
      await db.query(`
        INSERT INTO users (id, username, display_name, password_hash, role, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [id, normalizedUsername, normalizedDisplayName, passwordHash, role, status, toMySqlTimestamp(now), toMySqlTimestamp(now)]);
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') throw createError('USERNAME_TAKEN', 'username is already in use');
      throw error;
    }
    return findById(id);
  }

  async function findById(id) {
    return toPublicUser(await db.one('SELECT * FROM users WHERE id = ?', [id]));
  }

  async function findAuthById(id) {
    return toAuthUser(await db.one('SELECT * FROM users WHERE id = ?', [id]));
  }

  async function findByUsername(username) {
    let normalized;
    try { normalized = normalizeUsername(username); } catch { return null; }
    return toAuthUser(await db.one('SELECT * FROM users WHERE username = ?', [normalized]));
  }

  async function listUsers({ limit = 100, offset = 0 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw createError('INVALID_LIMIT', 'limit is invalid');
    if (!Number.isInteger(offset) || offset < 0) throw createError('INVALID_OFFSET', 'offset is invalid');
    return (await db.many('SELECT * FROM users ORDER BY username LIMIT ? OFFSET ?', [limit, offset])).map(toPublicUser);
  }

  async function updateLastLogin(id, now) {
    const result = await db.query('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?', [toMySqlTimestamp(now), toMySqlTimestamp(now), id]);
    return result.affectedRows === 1 ? findById(id) : null;
  }

  async function updatePassword(id, passwordHash, now) {
    if (typeof passwordHash !== 'string' || passwordHash === '') {
      throw createError('INVALID_PASSWORD_HASH', 'password hash is invalid');
    }
    const result = await db.query(`
      UPDATE users SET password_hash = ?, session_version = session_version + 1, updated_at = ? WHERE id = ?
    `, [passwordHash, toMySqlTimestamp(now), id]);
    return result.affectedRows === 1 ? findById(id) : null;
  }

  async function setStatus(id, status, now) {
    if (status !== 'active' && status !== 'disabled') {
      throw createError('INVALID_USER_STATUS', 'user status is invalid');
    }
    const result = await db.query(`
      UPDATE users SET status = ?, session_version = session_version + 1, updated_at = ? WHERE id = ?
    `, [status, toMySqlTimestamp(now), id]);
    return result.affectedRows === 1 ? findById(id) : null;
  }

  return { countUsers, createUser, findById, findAuthById, findByUsername, listUsers, updateLastLogin, updatePassword, setStatus };
}

module.exports = { createMySqlUserStore, toIsoTimestamp, toMySqlTimestamp };
