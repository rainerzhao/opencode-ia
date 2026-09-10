'use strict';

const { toIsoTimestamp, toMySqlTimestamp } = require('../users/mysql-user-store');

function validateHash(value, name) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError(`${name} must be a SHA-256 hex digest`);
  }
}

function toSession(row) {
  if (!row) return null;
  return {
    id: row.id, userId: row.user_id, tokenHash: row.token_hash, csrfTokenHash: row.csrf_token_hash,
    sessionVersion: Number(row.session_version), createdAt: toIsoTimestamp(row.created_at),
    lastSeenAt: toIsoTimestamp(row.last_seen_at), expiresAt: toIsoTimestamp(row.expires_at),
    revokedAt: toIsoTimestamp(row.revoked_at), sourceIp: row.source_ip, userAgent: row.user_agent
  };
}

function createMySqlSessionStore(db) {
  if (!db || typeof db.query !== 'function' || typeof db.one !== 'function') throw new TypeError('MySQL database is required');

  async function createSession({ id, userId, tokenHash, csrfTokenHash, sessionVersion, createdAt, expiresAt, sourceIp = null, userAgent = null }) {
    if (typeof id !== 'string' || id === '') throw new TypeError('session id is required');
    if (typeof userId !== 'string' || userId === '') throw new TypeError('session user id is required');
    validateHash(tokenHash, 'tokenHash');
    validateHash(csrfTokenHash, 'csrfTokenHash');
    if (!Number.isInteger(sessionVersion) || sessionVersion < 0) throw new TypeError('session version is invalid');
    if (typeof createdAt !== 'string' || typeof expiresAt !== 'string') throw new TypeError('session timestamps are required');
    await db.query(`
      INSERT INTO login_sessions (
        id, user_id, token_hash, csrf_token_hash, session_version,
        created_at, last_seen_at, expires_at, source_ip, user_agent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, userId, tokenHash, csrfTokenHash, sessionVersion,
      toMySqlTimestamp(createdAt), toMySqlTimestamp(createdAt), toMySqlTimestamp(expiresAt), sourceIp, userAgent
    ]);
    return findByTokenHash(tokenHash);
  }

  async function findByTokenHash(tokenHash) {
    validateHash(tokenHash, 'tokenHash');
    return toSession(await db.one('SELECT * FROM login_sessions WHERE token_hash = ?', [tokenHash]));
  }

  async function revokeById(id, revokedAt) {
    const result = await db.query('UPDATE login_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [toMySqlTimestamp(revokedAt), id]);
    return result.affectedRows === 1;
  }

  async function revokeForUser(userId, revokedAt) {
    const result = await db.query('UPDATE login_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [toMySqlTimestamp(revokedAt), userId]);
    return Number(result.affectedRows || 0);
  }

  return { createSession, findByTokenHash, revokeById, revokeForUser };
}

module.exports = { createMySqlSessionStore };
