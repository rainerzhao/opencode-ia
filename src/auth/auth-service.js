'use strict';

const crypto = require('node:crypto');
const { hashPassword, verifyPassword } = require('./password');
const { createSessionCredentials, hashToken } = require('./session-tokens');
const { createUserStore } = require('../users/user-store');
const { createSessionStore } = require('../sessions/session-store');
const { createAuditStore } = require('../audit/audit-store');

function authError(code, message, status, details) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details) error.details = details;
  return error;
}

function publicUser(user) {
  if (!user) return null;
  const {
    passwordHash: _passwordHash,
    sessionVersion: _sessionVersion,
    ...safe
  } = user;
  return safe;
}

function cleanSourceIp(sourceIp) {
  return typeof sourceIp === 'string' ? sourceIp.slice(0, 128) : null;
}

function cleanUserAgent(userAgent) {
  return typeof userAgent === 'string' ? userAgent.slice(0, 512) : null;
}

function createAuthService({
  db,
  loginLimiter,
  sessionTtlSeconds = 8 * 60 * 60,
  clock = () => new Date(),
  idFactory = crypto.randomUUID
}) {
  if (!db) throw new TypeError('database is required');
  if (!loginLimiter) throw new TypeError('login limiter is required');
  if (!Number.isInteger(sessionTtlSeconds) || sessionTtlSeconds < 60) {
    throw new TypeError('session TTL is invalid');
  }

  const userStore = createUserStore(db);
  const sessionStore = createSessionStore(db);
  const auditStore = createAuditStore(db);
  const dummyHash = hashPassword(`dummy-${crypto.randomBytes(16).toString('hex')}`);

  function timestamp() {
    const value = clock();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new TypeError('clock returned an invalid date');
    }
    return value;
  }

  function runTransaction(operation) {
    db.exec('BEGIN IMMEDIATE;');
    try {
      const result = operation();
      db.exec('COMMIT;');
      return result;
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  }

  function requireAdmin(actor) {
    if (!actor?.user || actor.user.role !== 'admin' || actor.user.status !== 'active') {
      throw authError('FORBIDDEN', 'Administrator access is required', 403);
    }
  }

  async function login({ username, password, sourceIp, userAgent }) {
    const attempt = { username, sourceIp: cleanSourceIp(sourceIp) };
    const gate = loginLimiter.check(attempt);
    if (!gate.allowed) {
      throw authError(
        'LOGIN_RATE_LIMITED',
        'Too many login attempts. Try again later.',
        429,
        { retryAfterSeconds: gate.retryAfterSeconds }
      );
    }

    const user = userStore.findByUsername(username);
    const encoded = user?.passwordHash || await dummyHash;
    const validPassword = await verifyPassword(password, encoded);
    if (!user || !validPassword || user.status !== 'active') {
      loginLimiter.recordFailure(attempt);
      throw authError('INVALID_CREDENTIALS', 'Invalid username or password', 401);
    }

    loginLimiter.recordSuccess(attempt);
    const credentials = createSessionCredentials();
    const created = timestamp();
    const createdAt = created.toISOString();
    const expiresAt = new Date(created.getTime() + sessionTtlSeconds * 1000).toISOString();
    const sessionId = idFactory();
    runTransaction(() => {
      sessionStore.createSession({
        id: sessionId,
        userId: user.id,
        tokenHash: credentials.tokenHash,
        csrfTokenHash: credentials.csrfTokenHash,
        sessionVersion: user.sessionVersion,
        createdAt,
        expiresAt,
        sourceIp: cleanSourceIp(sourceIp),
        userAgent: cleanUserAgent(userAgent)
      });
      userStore.updateLastLogin(user.id, createdAt);
      auditStore.append({
        actorUserId: user.id,
        action: 'auth.login',
        targetType: 'session',
        targetId: sessionId,
        metadata: {},
        sourceIp: cleanSourceIp(sourceIp),
        now: createdAt
      });
    });
    return {
      user: publicUser(userStore.findAuthById(user.id)),
      token: credentials.token,
      csrfToken: credentials.csrfToken,
      sessionId,
      expiresAt
    };
  }

  function authenticate(token) {
    let tokenHash;
    try {
      tokenHash = hashToken(token);
    } catch {
      throw authError('SESSION_INVALID', 'Authentication is required', 401);
    }
    const session = sessionStore.findByTokenHash(tokenHash);
    const now = timestamp();
    if (!session || session.revokedAt || Date.parse(session.expiresAt) <= now.getTime()) {
      throw authError('SESSION_INVALID', 'Authentication is required', 401);
    }
    const user = userStore.findAuthById(session.userId);
    if (
      !user ||
      user.status !== 'active' ||
      user.sessionVersion !== session.sessionVersion
    ) {
      throw authError('SESSION_INVALID', 'Authentication is required', 401);
    }
    return { user: publicUser(user), session };
  }

  async function logout({ token, sourceIp }) {
    const auth = authenticate(token);
    const now = timestamp().toISOString();
    runTransaction(() => {
      sessionStore.revokeById(auth.session.id, now);
      auditStore.append({
        actorUserId: auth.user.id,
        action: 'auth.logout',
        targetType: 'session',
        targetId: auth.session.id,
        metadata: {},
        sourceIp: cleanSourceIp(sourceIp),
        now
      });
    });
  }

  async function changePassword({ auth, currentPassword, newPassword, sourceIp }) {
    const stored = userStore.findByUsername(auth?.user?.username);
    if (!stored || !await verifyPassword(currentPassword, stored.passwordHash)) {
      throw authError('INVALID_CREDENTIALS', 'Current password is invalid', 401);
    }
    const passwordHash = await hashPassword(newPassword);
    const now = timestamp().toISOString();
    runTransaction(() => {
      userStore.updatePassword(stored.id, passwordHash, now);
      sessionStore.revokeForUser(stored.id, now);
      auditStore.append({
        actorUserId: stored.id,
        action: 'user.change_password',
        targetType: 'user',
        targetId: stored.id,
        metadata: {},
        sourceIp: cleanSourceIp(sourceIp),
        now
      });
    });
  }

  async function createUser({ actor, username, displayName, password, role, sourceIp }) {
    requireAdmin(actor);
    const passwordHash = await hashPassword(password);
    const now = timestamp().toISOString();
    const id = idFactory();
    return runTransaction(() => {
      const user = userStore.createUser({ id, username, displayName, passwordHash, role, now });
      auditStore.append({
        actorUserId: actor.user.id,
        action: 'user.create',
        targetType: 'user',
        targetId: user.id,
        metadata: { role: user.role, username: user.username },
        sourceIp: cleanSourceIp(sourceIp),
        now
      });
      return user;
    });
  }

  function listUsers({ actor }) {
    requireAdmin(actor);
    return userStore.listUsers();
  }

  async function resetPassword({ actor, targetUserId, newPassword, sourceIp }) {
    requireAdmin(actor);
    const target = userStore.findAuthById(targetUserId);
    if (!target) throw authError('USER_NOT_FOUND', 'User was not found', 404);
    const passwordHash = await hashPassword(newPassword);
    const now = timestamp().toISOString();
    runTransaction(() => {
      userStore.updatePassword(target.id, passwordHash, now);
      sessionStore.revokeForUser(target.id, now);
      auditStore.append({
        actorUserId: actor.user.id,
        action: 'user.reset_password',
        targetType: 'user',
        targetId: target.id,
        metadata: {},
        sourceIp: cleanSourceIp(sourceIp),
        now
      });
    });
  }

  function setUserStatus({ actor, targetUserId, status, sourceIp }) {
    requireAdmin(actor);
    if (actor.user.id === targetUserId && status === 'disabled') {
      throw authError('CANNOT_DISABLE_SELF', 'Administrators cannot disable their own account', 409);
    }
    const target = userStore.findAuthById(targetUserId);
    if (!target) throw authError('USER_NOT_FOUND', 'User was not found', 404);
    const now = timestamp().toISOString();
    return runTransaction(() => {
      const updated = userStore.setStatus(target.id, status, now);
      sessionStore.revokeForUser(target.id, now);
      auditStore.append({
        actorUserId: actor.user.id,
        action: 'user.set_status',
        targetType: 'user',
        targetId: target.id,
        metadata: { status },
        sourceIp: cleanSourceIp(sourceIp),
        now
      });
      return updated;
    });
  }

  function revokeUserSessions({ actor, targetUserId, sourceIp }) {
    requireAdmin(actor);
    const target = userStore.findById(targetUserId);
    if (!target) throw authError('USER_NOT_FOUND', 'User was not found', 404);
    const now = timestamp().toISOString();
    return runTransaction(() => {
      const revoked = sessionStore.revokeForUser(target.id, now);
      auditStore.append({
        actorUserId: actor.user.id,
        action: 'user.revoke_sessions',
        targetType: 'user',
        targetId: target.id,
        metadata: { revoked },
        sourceIp: cleanSourceIp(sourceIp),
        now
      });
      return revoked;
    });
  }

  return {
    login,
    authenticate,
    logout,
    changePassword,
    createUser,
    listUsers,
    resetPassword,
    setUserStatus,
    revokeUserSessions
  };
}

module.exports = { createAuthService };
