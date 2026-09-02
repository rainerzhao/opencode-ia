'use strict';

const crypto = require('node:crypto');
const { hashToken } = require('./session-tokens');
const { SESSION_COOKIE, CSRF_COOKIE, readCookie } = require('../http/cookies');

function middlewareError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function equalDigest(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createAuthMiddleware({ authService }) {
  if (!authService) throw new TypeError('auth service is required');

  function requireAuth(req, _res, next) {
    try {
      const token = readCookie(req.headers.cookie, SESSION_COOKIE);
      req.authToken = token;
      req.auth = authService.authenticate(token);
      next();
    } catch (error) {
      next(error);
    }
  }

  function requireRole(role) {
    return function roleMiddleware(req, _res, next) {
      if (req.auth?.user?.role !== role) {
        next(middlewareError('FORBIDDEN', 'You do not have permission to perform this action', 403));
        return;
      }
      next();
    };
  }

  function requireCsrf(req, _res, next) {
    try {
      const headerToken = req.get('x-csrf-token');
      const cookieToken = readCookie(req.headers.cookie, CSRF_COOKIE);
      const expectedHash = req.auth?.session?.csrfTokenHash;
      if (
        typeof headerToken !== 'string' ||
        typeof cookieToken !== 'string' ||
        headerToken !== cookieToken ||
        !equalDigest(hashToken(headerToken), expectedHash) ||
        !equalDigest(hashToken(cookieToken), expectedHash)
      ) {
        throw middlewareError('CSRF_INVALID', 'The CSRF token is invalid', 403);
      }
      next();
    } catch (error) {
      next(error.code === 'CSRF_INVALID'
        ? error
        : middlewareError('CSRF_INVALID', 'The CSRF token is invalid', 403));
    }
  }

  return { requireAuth, requireRole, requireCsrf };
}

module.exports = { createAuthMiddleware };
