'use strict';

const express = require('express');
const { diffText } = require('../../content/version-diff');

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
    INVALID_SOLUTION_MARKDOWN: 400,
    INVALID_CONTENT_SOURCE: 400,
    SOURCE_CONVERSATION_INVALID: 400,
    SOURCE_EVENTS_INVALID: 400,
    SOURCE_EVENT_CONVERSATION_MISMATCH: 400,
    SOURCE_EVENT_INVALID: 400,
    SOURCE_NO_COMPLETED_TURNS: 422,
    SOURCE_TOO_LARGE: 413,
    INVALID_CONTENT_VERSION: 400
  };
  if (statuses[error.code]) error.status = statuses[error.code];
  return error;
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next))
    .catch((error) => next(mapStoreError(error)));
}

function record(req, requestAuditor, action, targetType, targetId, content) {
  requestAuditor.record(req, {
    action,
    targetType,
    targetId,
    metadata: { version: content.version, status: content.status, visibility: content.visibility }
  });
}

function createContentRouter({ store, requestAuditor, conversationContentService = null }) {
  if (!store || !requestAuditor) throw new TypeError('content route dependencies are required');
  const router = express.Router();

  router.get('/knowledge', asyncRoute(async (req, res) => {
    res.json({ knowledge: await store.listKnowledge(actor(req)) });
  }));
  router.get('/knowledge/search', asyncRoute(async (req, res) => {
    res.json({ knowledge: await store.searchKnowledge({ ...actor(req), query: req.query.q || '' }) });
  }));
  router.post('/knowledge', asyncRoute(async (req, res) => {
    const knowledge = await store.createKnowledgeDraft({
      ...actor(req), title: req.body?.title, category: req.body?.category, tags: req.body?.tags, markdown: req.body?.markdown
    });
    record(req, requestAuditor, 'content.knowledge.create', 'knowledge_document', knowledge.id, knowledge);
    res.status(201).json({ knowledge });
  }));
  router.get('/knowledge/:contentId', asyncRoute(async (req, res) => {
    res.json({ knowledge: await store.getKnowledge({ ...actor(req), documentId: contentId(req.params.contentId), includeContent: true }) });
  }));
  router.get('/knowledge/:contentId/diff', asyncRoute(async (req, res) => {
    if (typeof store.getKnowledgeVersion !== 'function') throw routeError('CONTENT_FEATURE_UNAVAILABLE', 'content version diff is unavailable', 501);
    const documentId = contentId(req.params.contentId);
    const from = await store.getKnowledgeVersion({ ...actor(req), documentId, version: req.query.from });
    const to = await store.getKnowledgeVersion({ ...actor(req), documentId, version: req.query.to });
    res.json({ knowledgeId: documentId, from: { id: from.id, version: from.version, title: from.title }, to: { id: to.id, version: to.version, title: to.title }, diff: diffText(from.markdown, to.markdown) });
  }));
  router.patch('/knowledge/:contentId', asyncRoute(async (req, res) => {
    const knowledge = await store.saveKnowledgeVersion({
      ...actor(req), documentId: contentId(req.params.contentId), title: req.body?.title,
      category: req.body?.category, tags: req.body?.tags, markdown: req.body?.markdown
    });
    record(req, requestAuditor, 'content.knowledge.update', 'knowledge_document', knowledge.id, knowledge);
    res.json({ knowledge });
  }));
  router.post('/knowledge/:contentId/publish', asyncRoute(async (req, res) => {
    const knowledge = await store.publishKnowledge({ ...actor(req), documentId: contentId(req.params.contentId) });
    record(req, requestAuditor, 'content.knowledge.publish', 'knowledge_document', knowledge.id, knowledge);
    res.json({ knowledge });
  }));
  router.post('/knowledge/:contentId/withdraw', asyncRoute(async (req, res) => {
    const knowledge = await store.withdrawKnowledge({ ...actor(req), documentId: contentId(req.params.contentId) });
    record(req, requestAuditor, 'content.knowledge.withdraw', 'knowledge_document', knowledge.id, knowledge);
    res.json({ knowledge });
  }));

  router.get('/solutions', asyncRoute(async (req, res) => {
    res.json({ solutions: await store.listSolutions(actor(req)) });
  }));
  router.post('/solutions', asyncRoute(async (req, res) => {
    const solution = await store.createSolutionDraft({
      ...actor(req), title: req.body?.title, description: req.body?.description,
      solutionMarkdown: req.body?.solutionMarkdown
    });
    record(req, requestAuditor, 'content.solution.create', 'solution', solution.id, solution);
    res.status(201).json({ solution });
  }));
  if (conversationContentService) {
    router.post('/solutions/from-conversation', asyncRoute(async (req, res) => {
      const solution = await conversationContentService.createSolutionFromConversation({
        ...actor(req), conversationId: contentId(req.body?.conversationId),
        title: req.body?.title, description: req.body?.description
      });
      record(req, requestAuditor, 'content.solution.create_from_conversation', 'solution', solution.id, solution);
      res.status(201).json({ solution });
    }));
  }
  router.get('/solutions/:contentId', asyncRoute(async (req, res) => {
    res.json({ solution: await store.getSolution({ ...actor(req), solutionId: contentId(req.params.contentId), includeContent: true }) });
  }));
  router.patch('/solutions/:contentId', asyncRoute(async (req, res) => {
    const solution = await store.saveSolutionVersion({
      ...actor(req), solutionId: contentId(req.params.contentId), title: req.body?.title,
      description: req.body?.description, solutionMarkdown: req.body?.solutionMarkdown
    });
    record(req, requestAuditor, 'content.solution.update', 'solution', solution.id, solution);
    res.json({ solution });
  }));
  for (const [verb, method] of [['publish', 'publishSolution'], ['withdraw', 'withdrawSolution']]) {
    router.post(`/solutions/:contentId/${verb}`, asyncRoute(async (req, res) => {
      const solution = await store[method]({ ...actor(req), solutionId: contentId(req.params.contentId) });
      record(req, requestAuditor, `content.solution.${verb}`, 'solution', solution.id, solution);
      res.json({ solution });
    }));
  }
  router.post('/solutions/:contentId/to-knowledge', asyncRoute(async (req, res) => {
    if (typeof store.createKnowledgeFromSolution !== 'function') {
      throw routeError('CONTENT_FEATURE_UNAVAILABLE', 'content conversion is unavailable', 501);
    }
    const knowledge = await store.createKnowledgeFromSolution({
      ...actor(req), solutionId: contentId(req.params.contentId), title: req.body?.title,
      category: req.body?.category, tags: req.body?.tags, markdown: req.body?.markdown
    });
    record(req, requestAuditor, 'content.knowledge.create_from_solution', 'knowledge_document', knowledge.id, knowledge);
    res.status(201).json({ knowledge });
  }));
  return router;
}

module.exports = { createContentRouter };
