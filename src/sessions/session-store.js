'use strict';

function validateHash(value, name) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError(`${name} must be a SHA-256 hex digest`);
  }
}

function toSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    csrfTokenHash: row.csrf_token_hash,
    sessionVersion: row.session_version,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    sourceIp: row.source_ip,
    userAgent: row.user_agent
  };
}

function createSessionStore(db) {
  const insertStatement = db.prepare(`
    INSERT INTO login_sessions (
      id, user_id, token_hash, csrf_token_hash, session_version,
      created_at, last_seen_at, expires_at, source_ip, user_agent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const byHashStatement = db.prepare('SELECT * FROM login_sessions WHERE token_hash = ?');
  const revokeOneStatement = db.prepare(`
    UPDATE login_sessions SET revoked_at = ?
    WHERE id = ? AND revoked_at IS NULL
  `);
  const revokeUserStatement = db.prepare(`
    UPDATE login_sessions SET revoked_at = ?
    WHERE user_id = ? AND revoked_at IS NULL
  `);

  function createSession({
    id,
    userId,
    tokenHash,
    csrfTokenHash,
    sessionVersion,
    createdAt,
    expiresAt,
    sourceIp = null,
    userAgent = null
  }) {
    if (typeof id !== 'string' || id === '') throw new TypeError('session id is required');
    if (typeof userId !== 'string' || userId === '') throw new TypeError('session user id is required');
    validateHash(tokenHash, 'tokenHash');
    validateHash(csrfTokenHash, 'csrfTokenHash');
    if (!Number.isInteger(sessionVersion) || sessionVersion < 0) {
      throw new TypeError('session version is invalid');
    }
    if (typeof createdAt !== 'string' || typeof expiresAt !== 'string') {
      throw new TypeError('session timestamps are required');
    }

    insertStatement.run(
      id,
      userId,
      tokenHash,
      csrfTokenHash,
      sessionVersion,
      createdAt,
      createdAt,
      expiresAt,
      sourceIp,
      userAgent
    );
    return toSession(byHashStatement.get(tokenHash));
  }

  function findByTokenHash(tokenHash) {
    validateHash(tokenHash, 'tokenHash');
    return toSession(byHashStatement.get(tokenHash));
  }

  function revokeById(id, revokedAt) {
    return revokeOneStatement.run(revokedAt, id).changes === 1;
  }

  function revokeForUser(userId, revokedAt) {
    return revokeUserStatement.run(revokedAt, userId).changes;
  }

  return { createSession, findByTokenHash, revokeById, revokeForUser };
}

module.exports = { createSessionStore };
