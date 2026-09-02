'use strict';

const express = require('express');
const { serializeAuthCookies, serializeClearedAuthCookies } = require('../../http/cookies');

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function sourceIp(req) {
  return req.socket?.remoteAddress || null;
}

function createAuthRouter({ authService, authMiddleware, config }) {
  const router = express.Router();
  const { requireAuth, requireCsrf } = authMiddleware;

  router.use((_req, res, next) => {
    res.setHeader('cache-control', 'no-store');
    next();
  });

  router.post('/login', asyncRoute(async (req, res) => {
    try {
      const login = await authService.login({
        username: req.body?.username,
        password: req.body?.password,
        sourceIp: sourceIp(req),
        userAgent: req.get('user-agent')
      });
      res.setHeader('set-cookie', serializeAuthCookies({
        token: login.token,
        csrfToken: login.csrfToken,
        maxAgeSeconds: config.sessionTtlSeconds,
        secure: config.cookieSecure
      }));
      res.json({ user: login.user, expiresAt: login.expiresAt });
    } catch (error) {
      if (error.code === 'LOGIN_RATE_LIMITED' && error.details?.retryAfterSeconds) {
        res.setHeader('retry-after', String(error.details.retryAfterSeconds));
      }
      throw error;
    }
  }));

  router.get('/me', requireAuth, (req, res) => {
    res.json({ user: req.auth.user });
  });

  router.post('/logout', requireAuth, requireCsrf, asyncRoute(async (req, res) => {
    await authService.logout({ token: req.authToken, sourceIp: sourceIp(req) });
    res.setHeader('set-cookie', serializeClearedAuthCookies({ secure: config.cookieSecure }));
    res.status(204).end();
  }));

  router.post('/change-password', requireAuth, requireCsrf, asyncRoute(async (req, res) => {
    await authService.changePassword({
      auth: req.auth,
      currentPassword: req.body?.currentPassword,
      newPassword: req.body?.newPassword,
      sourceIp: sourceIp(req)
    });
    res.setHeader('set-cookie', serializeClearedAuthCookies({ secure: config.cookieSecure }));
    res.status(204).end();
  }));

  return router;
}

module.exports = { createAuthRouter };
