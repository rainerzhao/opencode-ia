'use strict';

const crypto = require('node:crypto');
const { hashPassword, verifyPassword } = require('./password');
const { createSessionCredentials, hashToken } = require('./session-tokens');
const { createMySqlIdentityRepositories } = require('./mysql-identity-repositories');

function authError(code, message, status, details) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details) error.details = details;
  return error;
}

function publicUser(user) {
  if (!user) return null;
  const { passwordHash: _passwordHash, sessionVersion: _sessionVersion, ...safe } = user;
  return safe;
}

function cleanSourceIp(value) { return typeof value === 'string' ? value.slice(0, 128) : null; }
function cleanUserAgent(value) { return typeof value === 'string' ? value.slice(0, 512) : null; }

function createMySqlAuthService({
  db, loginLimiter, sessionTtlSeconds = 8 * 60 * 60, clock = () => new Date(), idFactory = crypto.randomUUID,
  repositoryFactory = createMySqlIdentityRepositories
}) {
  if (!db || typeof db.transaction !== 'function') throw new TypeError('MySQL database is required');
  if (!loginLimiter) throw new TypeError('login limiter is required');
  if (!Number.isInteger(sessionTtlSeconds) || sessionTtlSeconds < 60) throw new TypeError('session TTL is invalid');

  const repositories = repositoryFactory(db);
  const dummyHash = hashPassword(`dummy-${crypto.randomBytes(16).toString('hex')}`);
  function timestamp() {
    const value = clock();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new TypeError('clock returned an invalid date');
    return value;
  }
  function requireAdmin(actor) {
    if (!actor?.user || actor.user.role !== 'admin' || actor.user.status !== 'active') {
      throw authError('FORBIDDEN', 'Administrator access is required', 403);
    }
  }
  async function transaction(operation) {
    return db.transaction(async (tx) => operation(repositoryFactory(tx)));
  }
  async function authenticate(token) {
    let tokenHash;
    try { tokenHash = hashToken(token); } catch { throw authError('SESSION_INVALID', 'Authentication is required', 401); }
    const session = await repositories.sessionStore.findByTokenHash(tokenHash);
    const now = timestamp();
    if (!session || session.revokedAt || Date.parse(session.expiresAt) <= now.getTime()) {
      throw authError('SESSION_INVALID', 'Authentication is required', 401);
    }
    const user = await repositories.userStore.findAuthById(session.userId);
    if (!user || user.status !== 'active' || user.sessionVersion !== session.sessionVersion) {
      throw authError('SESSION_INVALID', 'Authentication is required', 401);
    }
    return { user: publicUser(user), session };
  }
  async function login({ username, password, sourceIp, userAgent }) {
    const attempt = { username, sourceIp: cleanSourceIp(sourceIp) };
    const gate = loginLimiter.check(attempt);
    if (!gate.allowed) throw authError('LOGIN_RATE_LIMITED', 'Too many login attempts. Try again later.', 429, { retryAfterSeconds: gate.retryAfterSeconds });
    const user = await repositories.userStore.findByUsername(username);
    const validPassword = await verifyPassword(password, user?.passwordHash || await dummyHash);
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
    await transaction(async ({ sessionStore, userStore, auditStore }) => {
      await sessionStore.createSession({
        id: sessionId, userId: user.id, tokenHash: credentials.tokenHash, csrfTokenHash: credentials.csrfTokenHash,
        sessionVersion: user.sessionVersion, createdAt, expiresAt, sourceIp: cleanSourceIp(sourceIp), userAgent: cleanUserAgent(userAgent)
      });
      await userStore.updateLastLogin(user.id, createdAt);
      await auditStore.append({ actorUserId: user.id, action: 'auth.login', targetType: 'session', targetId: sessionId, metadata: {}, sourceIp: cleanSourceIp(sourceIp), now: createdAt });
    });
    return { user: publicUser(await repositories.userStore.findAuthById(user.id)), token: credentials.token, csrfToken: credentials.csrfToken, sessionId, expiresAt };
  }
  async function logout({ token, sourceIp }) {
    const auth = await authenticate(token);
    const now = timestamp().toISOString();
    await transaction(async ({ sessionStore, auditStore }) => {
      await sessionStore.revokeById(auth.session.id, now);
      await auditStore.append({ actorUserId: auth.user.id, action: 'auth.logout', targetType: 'session', targetId: auth.session.id, metadata: {}, sourceIp: cleanSourceIp(sourceIp), now });
    });
  }
  async function changePassword({ auth, currentPassword, newPassword, sourceIp }) {
    const stored = await repositories.userStore.findByUsername(auth?.user?.username);
    if (!stored || !await verifyPassword(currentPassword, stored.passwordHash)) throw authError('INVALID_CREDENTIALS', 'Current password is invalid', 401);
    const passwordHash = await hashPassword(newPassword);
    const now = timestamp().toISOString();
    await transaction(async ({ userStore, sessionStore, auditStore }) => {
      await userStore.updatePassword(stored.id, passwordHash, now);
      await sessionStore.revokeForUser(stored.id, now);
      await auditStore.append({ actorUserId: stored.id, action: 'user.change_password', targetType: 'user', targetId: stored.id, metadata: {}, sourceIp: cleanSourceIp(sourceIp), now });
    });
  }
  async function createUser({ actor, username, displayName, password, role, sourceIp }) {
    requireAdmin(actor);
    const passwordHash = await hashPassword(password);
    const now = timestamp().toISOString();
    const id = idFactory();
    return transaction(async ({ userStore, auditStore }) => {
      const user = await userStore.createUser({ id, username, displayName, passwordHash, role, now });
      await auditStore.append({ actorUserId: actor.user.id, action: 'user.create', targetType: 'user', targetId: user.id, metadata: { role: user.role, username: user.username }, sourceIp: cleanSourceIp(sourceIp), now });
      return user;
    });
  }
  async function listUsers({ actor }) { requireAdmin(actor); return repositories.userStore.listUsers(); }
  async function resetPassword({ actor, targetUserId, newPassword, sourceIp }) {
    requireAdmin(actor);
    const target = await repositories.userStore.findAuthById(targetUserId);
    if (!target) throw authError('USER_NOT_FOUND', 'User was not found', 404);
    const passwordHash = await hashPassword(newPassword); const now = timestamp().toISOString();
    await transaction(async ({ userStore, sessionStore, auditStore }) => {
      await userStore.updatePassword(target.id, passwordHash, now); await sessionStore.revokeForUser(target.id, now);
      await auditStore.append({ actorUserId: actor.user.id, action: 'user.reset_password', targetType: 'user', targetId: target.id, metadata: {}, sourceIp: cleanSourceIp(sourceIp), now });
    });
  }
  async function setUserStatus({ actor, targetUserId, status, sourceIp }) {
    requireAdmin(actor);
    if (actor.user.id === targetUserId && status === 'disabled') throw authError('CANNOT_DISABLE_SELF', 'Administrators cannot disable their own account', 409);
    const target = await repositories.userStore.findAuthById(targetUserId);
    if (!target) throw authError('USER_NOT_FOUND', 'User was not found', 404);
    const now = timestamp().toISOString();
    return transaction(async ({ userStore, sessionStore, auditStore }) => {
      const updated = await userStore.setStatus(target.id, status, now); await sessionStore.revokeForUser(target.id, now);
      await auditStore.append({ actorUserId: actor.user.id, action: 'user.set_status', targetType: 'user', targetId: target.id, metadata: { status }, sourceIp: cleanSourceIp(sourceIp), now });
      return updated;
    });
  }
  async function revokeUserSessions({ actor, targetUserId, sourceIp }) {
    requireAdmin(actor);
    const target = await repositories.userStore.findById(targetUserId);
    if (!target) throw authError('USER_NOT_FOUND', 'User was not found', 404);
    const now = timestamp().toISOString();
    return transaction(async ({ sessionStore, auditStore }) => {
      const revoked = await sessionStore.revokeForUser(target.id, now);
      await auditStore.append({ actorUserId: actor.user.id, action: 'user.revoke_sessions', targetType: 'user', targetId: target.id, metadata: { revoked }, sourceIp: cleanSourceIp(sourceIp), now });
      return revoked;
    });
  }
  return { login, authenticate, logout, changePassword, createUser, listUsers, resetPassword, setUserStatus, revokeUserSessions };
}

module.exports = { createMySqlAuthService };
