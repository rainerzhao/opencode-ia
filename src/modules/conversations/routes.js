'use strict';

const express = require('express');

function routeError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function conversationId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) {
    throw routeError('INVALID_CONVERSATION_ID', 'conversation id is invalid', 400);
  }
  return value;
}

function mapStoreError(error) {
  const statuses = {
    CONVERSATION_NOT_FOUND: 404,
    CONVERSATION_ARCHIVED: 409,
    INVALID_CONVERSATION_TITLE: 400,
    INVALID_CONVERSATION_ID: 400,
    INVALID_CONVERSATION_STATUS: 400,
    INVALID_MODEL_ID: 400,
    INVALID_LIMIT: 400,
    INVALID_OFFSET: 400
  };
  if (statuses[error.code]) error.status = statuses[error.code];
  return error;
}

function createConversationRouter({ store, requestAuditor }) {
  if (!store || !requestAuditor) throw new TypeError('conversation route dependencies are required');
  const router = express.Router();

  router.get('/', (req, res, next) => {
    try {
      const status = req.query.status || 'active';
      const conversations = store.listConversations({
        ownerUserId: req.auth.user.id,
        status
      });
      res.json({ conversations });
    } catch (error) { next(mapStoreError(error)); }
  });

  router.post('/', (req, res, next) => {
    try {
      const conversation = store.createConversation({
        ownerUserId: req.auth.user.id,
        title: req.body?.title,
        defaultModel: req.body?.defaultModel
      });
      requestAuditor.record(req, {
        action: 'conversation.create',
        targetType: 'conversation',
        targetId: conversation.id,
        metadata: { visibility: 'private' }
      });
      res.status(201).json({ conversation });
    } catch (error) { next(mapStoreError(error)); }
  });

  router.get('/:conversationId', (req, res, next) => {
    try {
      const conversation = store.getOwnedConversation({
        id: conversationId(req.params.conversationId),
        ownerUserId: req.auth.user.id
      });
      if (!conversation) throw routeError('CONVERSATION_NOT_FOUND', 'conversation was not found', 404);
      res.json({ conversation });
    } catch (error) { next(mapStoreError(error)); }
  });

  router.patch('/:conversationId', (req, res, next) => {
    try {
      const conversation = store.updateConversation({
        id: conversationId(req.params.conversationId),
        ownerUserId: req.auth.user.id,
        title: req.body?.title
      });
      requestAuditor.record(req, {
        action: 'conversation.rename',
        targetType: 'conversation',
        targetId: conversation.id,
        metadata: {}
      });
      res.json({ conversation });
    } catch (error) { next(mapStoreError(error)); }
  });

  router.delete('/:conversationId', (req, res, next) => {
    try {
      const conversation = store.archiveConversation({
        id: conversationId(req.params.conversationId),
        ownerUserId: req.auth.user.id
      });
      requestAuditor.record(req, {
        action: 'conversation.archive',
        targetType: 'conversation',
        targetId: conversation.id,
        metadata: {}
      });
      res.status(204).end();
    } catch (error) { next(mapStoreError(error)); }
  });

  return router;
}

function createConversationAdminRouter({ store, requireAdmin }) {
  if (!store || typeof requireAdmin !== 'function') {
    throw new TypeError('conversation admin route dependencies are required');
  }
  const router = express.Router();
  router.use(requireAdmin);
  router.get('/', asyncRoute(async (_req, res) => {
    res.json({ conversations: store.listConversationMetadata() });
  }));
  return router;
}

module.exports = { createConversationAdminRouter, createConversationRouter };
