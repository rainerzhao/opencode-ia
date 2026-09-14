'use strict';

const express = require('express');

function routeError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch((error) => next(mapStoreError(error)));
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

function historyNumber(value, { fallback, min, max } = {}) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw routeError('INVALID_EVENT_SEQUENCE', 'event cursor is invalid', 400);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw routeError('INVALID_EVENT_SEQUENCE', 'event cursor is invalid', 400);
  return number;
}
function listNumber(value, { fallback, min, max, code } = {}) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw routeError(code, 'conversation pagination is invalid', 400);
  const number = Number(value); if (!Number.isSafeInteger(number) || number < min || number > max) throw routeError(code, 'conversation pagination is invalid', 400); return number;
}
function queryText(value) { if (value === undefined) return ''; if (typeof value !== 'string' || value.length > 200 || /[\u0000-\u001f]/.test(value)) throw routeError('INVALID_CONVERSATION_QUERY', 'conversation query is invalid', 400); return value.trim(); }

function createConversationRouter({ store, requestAuditor }) {
  if (!store || !requestAuditor) throw new TypeError('conversation route dependencies are required');
  const router = express.Router();

  router.get('/', asyncRoute(async (req, res) => {
    const status = req.query.status || 'active'; const limit = listNumber(req.query.limit, { fallback: 50, min: 1, max: 100, code: 'INVALID_LIMIT' }); const offset = listNumber(req.query.offset, { fallback: 0, min: 0, max: 100000, code: 'INVALID_OFFSET' });
    const rows = await store.listConversations({ ownerUserId: req.auth.user.id, status, q: queryText(req.query.q), limit: limit + 1, offset });
    res.json({ conversations: rows.slice(0, limit), hasMore: rows.length > limit, nextOffset: rows.length > limit ? offset + limit : null });
  }));

  router.post('/', asyncRoute(async (req, res) => {
      const conversation = await store.createConversation({
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
  }));

  router.get('/:conversationId/events', asyncRoute(async (req, res) => {
    const id = conversationId(req.params.conversationId);
    const afterSequence = historyNumber(req.query.afterSequence, { fallback: 0, min: 0, max: Number.MAX_SAFE_INTEGER });
    const limit = historyNumber(req.query.limit, { fallback: 100, min: 1, max: 1000 });
    const latestSequence = await store.getLatestEventSequence({ conversationId: id, ownerUserId: req.auth.user.id });
    if (latestSequence === null) throw routeError('CONVERSATION_NOT_FOUND', 'conversation was not found', 404);
    const events = await store.listEventsAfter({ conversationId: id, ownerUserId: req.auth.user.id, afterSequence, limit });
    if (events === null) throw routeError('CONVERSATION_NOT_FOUND', 'conversation was not found', 404);
    const nextAfterSequence = events.at(-1)?.sequence || afterSequence;
    res.json({ events, nextAfterSequence, hasMore: nextAfterSequence < latestSequence });
  }));

  router.get('/:conversationId', asyncRoute(async (req, res) => {
      const conversation = await store.getOwnedConversation({
        id: conversationId(req.params.conversationId),
        ownerUserId: req.auth.user.id
      });
      if (!conversation) throw routeError('CONVERSATION_NOT_FOUND', 'conversation was not found', 404);
      res.json({ conversation });
  }));

  router.patch('/:conversationId', asyncRoute(async (req, res) => {
      const conversation = await store.updateConversation({
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
  }));

  router.delete('/:conversationId', asyncRoute(async (req, res) => {
      const conversation = await store.archiveConversation({
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
  }));
  router.post('/:conversationId/restore', asyncRoute(async (req, res) => {
    const conversation = await store.restoreConversation({ id: conversationId(req.params.conversationId), ownerUserId: req.auth.user.id });
    requestAuditor.record(req, { action: 'conversation.restore', targetType: 'conversation', targetId: conversation.id, metadata: {} });
    res.json({ conversation });
  }));

  return router;
}

function createConversationAdminRouter({ store, requireAdmin }) {
  if (!store || typeof requireAdmin !== 'function') {
    throw new TypeError('conversation admin route dependencies are required');
  }
  const router = express.Router();
  router.use(requireAdmin);
  router.get('/', asyncRoute(async (_req, res) => {
    res.json({ conversations: await store.listConversationMetadata() });
  }));
  return router;
}

module.exports = { createConversationAdminRouter, createConversationRouter };
