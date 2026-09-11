'use strict';

const { extractConversationSource } = require('./conversation-source');

const PAGE_SIZE = 1000;
const MAX_SOURCE_EVENTS = 5000;

function serviceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createConversationContentService({ gatewayStore, contentStore }) {
  if (!gatewayStore || typeof gatewayStore.listEventsAfter !== 'function' ||
    !contentStore || typeof contentStore.createSolutionFromConversation !== 'function') {
    throw new TypeError('conversation content service dependencies are required');
  }

  async function listSourceEvents({ conversationId, ownerUserId }) {
    const events = [];
    let afterSequence = 0;
    while (events.length < MAX_SOURCE_EVENTS) {
      const page = await Promise.resolve(gatewayStore.listEventsAfter({
        conversationId, ownerUserId, afterSequence, limit: PAGE_SIZE
      }));
      if (page === null) throw serviceError('CONTENT_NOT_FOUND', 'content was not found');
      events.push(...page);
      if (page.length < PAGE_SIZE) break;
      afterSequence = page.at(-1)?.sequence || afterSequence;
      if (!afterSequence) break;
    }
    return events;
  }

  async function createSolutionFromConversation({ actorUserId, actorRole, conversationId, title, description = '' }) {
    const events = await listSourceEvents({ conversationId, ownerUserId: actorUserId });
    const source = extractConversationSource({ conversationId, events });
    return contentStore.createSolutionFromConversation({
      actorUserId, actorRole, conversationId, title, description,
      assistantMarkdown: source.assistantMarkdown,
      firstSequence: source.firstSequence,
      lastSequence: source.lastSequence,
      completedTurnCount: source.completedTurnCount,
      contentSha256: source.contentSha256
    });
  }

  return Object.freeze({ createSolutionFromConversation });
}

module.exports = { createConversationContentService };
