'use strict';

const express = require('express');

function routeError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function contentId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) {
    throw routeError('INVALID_CONTENT_ID', 'content id is invalid');
  }
  return value;
}

function actor(req) {
  return { actorUserId: req.auth.user.id, actorRole: req.auth.user.role };
}

function mapStoreError(error) {
  const statuses = {
    CONTENT_NOT_FOUND: 404,
    INVALID_CONTENT_ID: 400,
    INVALID_CONTENT_ACTOR: 400,
    INVALID_CONTENT_VISIBILITY: 400,
    INVALID_CONTENT_STATUS: 400,
    INVALID_CONTENT_TAGS: 400,
    INVALID_CONTENT_REFERENCES: 400,
    INVALID_CONTENT_QUERY: 400,
    INVALID_KNOWLEDGE_TITLE: 400,
    INVALID_KNOWLEDGE_CATEGORY: 400,
    INVALID_KNOWLEDGE_MARKDOWN: 400,
    INVALID_SOLUTION_TITLE: 400,
    INVALID_SOLUTION_DESCRIPTION: 400,
    INVALID_SOLUTION_MARKDOWN: 400
  };
  if (statuses[error.code]) error.status = statuses[error.code];
  return error;
}

function record(req, requestAuditor, action, targetType, targetId, content) {
  requestAuditor.record(req, {
    action,
    targetType,
    targetId,
    metadata: { version: content.version, status: content.status, visibility: content.visibility }
  });
}

function createContentRouter({ store, requestAuditor }) {
  if (!store || !requestAuditor) throw new TypeError('content route dependencies are required');
  const router = express.Router();

  router.get('/knowledge', (req, res, next) => {
    try { res.json({ knowledge: store.listKnowledge(actor(req)) }); } catch (error) { next(mapStoreError(error)); }
  });
  router.get('/knowledge/search', (req, res, next) => {
    try { res.json({ knowledge: store.searchKnowledge({ ...actor(req), query: req.query.q || '' }) }); } catch (error) { next(mapStoreError(error)); }
  });
  router.post('/knowledge', (req, res, next) => {
    try {
      const knowledge = store.createKnowledgeDraft({
        ...actor(req), title: req.body?.title, category: req.body?.category, tags: req.body?.tags, markdown: req.body?.markdown
      });
      record(req, requestAuditor, 'content.knowledge.create', 'knowledge_document', knowledge.id, knowledge);
      res.status(201).json({ knowledge });
    } catch (error) { next(mapStoreError(error)); }
  });
  router.get('/knowledge/:contentId', (req, res, next) => {
    try { res.json({ knowledge: store.getKnowledge({ ...actor(req), documentId: contentId(req.params.contentId), includeContent: true }) }); } catch (error) { next(mapStoreError(error)); }
  });
  router.patch('/knowledge/:contentId', (req, res, next) => {
    try {
      const knowledge = store.saveKnowledgeVersion({
        ...actor(req), documentId: contentId(req.params.contentId), title: req.body?.title,
        category: req.body?.category, tags: req.body?.tags, markdown: req.body?.markdown
      });
      record(req, requestAuditor, 'content.knowledge.update', 'knowledge_document', knowledge.id, knowledge);
      res.json({ knowledge });
    } catch (error) { next(mapStoreError(error)); }
  });
  router.post('/knowledge/:contentId/publish', (req, res, next) => {
    try {
      const knowledge = store.publishKnowledge({ ...actor(req), documentId: contentId(req.params.contentId) });
      record(req, requestAuditor, 'content.knowledge.publish', 'knowledge_document', knowledge.id, knowledge);
      res.json({ knowledge });
    } catch (error) { next(mapStoreError(error)); }
  });
  router.post('/knowledge/:contentId/withdraw', (req, res, next) => {
    try {
      const knowledge = store.withdrawKnowledge({ ...actor(req), documentId: contentId(req.params.contentId) });
      record(req, requestAuditor, 'content.knowledge.withdraw', 'knowledge_document', knowledge.id, knowledge);
      res.json({ knowledge });
    } catch (error) { next(mapStoreError(error)); }
  });

  router.get('/solutions', (req, res, next) => {
    try { res.json({ solutions: store.listSolutions(actor(req)) }); } catch (error) { next(mapStoreError(error)); }
  });
  router.post('/solutions', (req, res, next) => {
    try {
      const solution = store.createSolutionDraft({
        ...actor(req), title: req.body?.title, description: req.body?.description,
        solutionMarkdown: req.body?.solutionMarkdown
      });
      record(req, requestAuditor, 'content.solution.create', 'solution', solution.id, solution);
      res.status(201).json({ solution });
    } catch (error) { next(mapStoreError(error)); }
  });
  router.get('/solutions/:contentId', (req, res, next) => {
    try { res.json({ solution: store.getSolution({ ...actor(req), solutionId: contentId(req.params.contentId), includeContent: true }) }); } catch (error) { next(mapStoreError(error)); }
  });
  router.patch('/solutions/:contentId', (req, res, next) => {
    try {
      const solution = store.saveSolutionVersion({
        ...actor(req), solutionId: contentId(req.params.contentId), title: req.body?.title,
        description: req.body?.description, solutionMarkdown: req.body?.solutionMarkdown
      });
      record(req, requestAuditor, 'content.solution.update', 'solution', solution.id, solution);
      res.json({ solution });
    } catch (error) { next(mapStoreError(error)); }
  });
  for (const [verb, method] of [['publish', 'publishSolution'], ['withdraw', 'withdrawSolution']]) {
    router.post(`/solutions/:contentId/${verb}`, (req, res, next) => {
      try {
        const solution = store[method]({ ...actor(req), solutionId: contentId(req.params.contentId) });
        record(req, requestAuditor, `content.solution.${verb}`, 'solution', solution.id, solution);
        res.json({ solution });
      } catch (error) { next(mapStoreError(error)); }
    });
  }
  return router;
}

module.exports = { createContentRouter };
