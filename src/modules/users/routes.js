'use strict';

const express = require('express');

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function sourceIp(req) {
  return req.socket?.remoteAddress || null;
}

function createUserAdminRouter({ authService, authMiddleware }) {
  const router = express.Router();
  const { requireAuth, requireRole, requireCsrf } = authMiddleware;
  const adminOnly = requireRole('admin');

  router.use((_req, res, next) => {
    res.setHeader('cache-control', 'no-store');
    next();
  });
  router.use(requireAuth, adminOnly);

  router.get('/', (req, res) => {
    res.json({ users: authService.listUsers({ actor: req.auth }) });
  });

  router.post('/', requireCsrf, asyncRoute(async (req, res) => {
    const user = await authService.createUser({
      actor: req.auth,
      username: req.body?.username,
      displayName: req.body?.displayName,
      password: req.body?.password,
      role: req.body?.role,
      sourceIp: sourceIp(req)
    });
    res.status(201).json({ user });
  }));

  router.put('/:userId/password', requireCsrf, asyncRoute(async (req, res) => {
    await authService.resetPassword({
      actor: req.auth,
      targetUserId: req.params.userId,
      newPassword: req.body?.newPassword,
      sourceIp: sourceIp(req)
    });
    res.status(204).end();
  }));

  router.put('/:userId/status', requireCsrf, (req, res) => {
    const user = authService.setUserStatus({
      actor: req.auth,
      targetUserId: req.params.userId,
      status: req.body?.status,
      sourceIp: sourceIp(req)
    });
    res.json({ user });
  });

  router.post('/:userId/sessions/revoke', requireCsrf, (req, res) => {
    authService.revokeUserSessions({
      actor: req.auth,
      targetUserId: req.params.userId,
      sourceIp: sourceIp(req)
    });
    res.status(204).end();
  });

  return router;
}

module.exports = { createUserAdminRouter };
