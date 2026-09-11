'use strict';

const crypto = require('node:crypto');

const MAX_EVENTS = 5000;
const MAX_MARKDOWN_BYTES = 1024 * 1024;
const EVENT_TYPES = new Set([
  'message.created', 'message.delta', 'job.started', 'job.queued', 'job.completed',
  'job.failed', 'job.cancelled', 'job.interrupted'
]);

function sourceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requiredId(value, code, message) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) {
    throw sourceError(code, message);
  }
  return value;
}

function extractConversationSource({ conversationId, events } = {}) {
  const conversation = requiredId(conversationId, 'SOURCE_CONVERSATION_INVALID', 'conversation id is invalid');
  if (!Array.isArray(events) || events.length < 1 || events.length > MAX_EVENTS) {
    throw sourceError('SOURCE_EVENTS_INVALID', 'conversation event range is invalid');
  }

  let previousSequence = 0;
  const turns = new Map();
  for (const item of events) {
    if (!item || typeof item !== 'object' || item.conversationId !== conversation) {
      throw sourceError('SOURCE_EVENT_CONVERSATION_MISMATCH', 'conversation event does not belong to the requested conversation');
    }
    if (!Number.isInteger(item.sequence) || item.sequence < 1 || item.sequence <= previousSequence || !EVENT_TYPES.has(item.type)) {
      throw sourceError('SOURCE_EVENT_INVALID', 'conversation event is invalid');
    }
    previousSequence = item.sequence;
    if (item.jobId === null || item.jobId === undefined) continue;
    const jobId = requiredId(item.jobId, 'SOURCE_EVENT_INVALID', 'conversation event is invalid');
    const turn = turns.get(jobId) || { jobId, sequence: item.sequence, failed: false, completed: false, parts: [] };
    turn.sequence = Math.min(turn.sequence, item.sequence);
    if (item.type === 'message.delta') {
      if (!item.data || typeof item.data !== 'object' || typeof item.data.text !== 'string' || !item.data.text.trim()) {
        throw sourceError('SOURCE_EVENT_INVALID', 'conversation event is invalid');
      }
      if (Buffer.byteLength(item.data.text, 'utf8') > MAX_MARKDOWN_BYTES) {
        throw sourceError('SOURCE_TOO_LARGE', 'conversation source is too large');
      }
      turn.parts.push(item.data.text);
    } else if (item.type === 'job.completed') {
      turn.completed = true;
      turn.completedSequence = item.sequence;
    } else if (item.type === 'job.failed' || item.type === 'job.cancelled' || item.type === 'job.interrupted') {
      turn.failed = true;
    }
    turns.set(jobId, turn);
  }

  const completed = [...turns.values()]
    .filter((turn) => turn.completed && !turn.failed && turn.parts.length > 0)
    .sort((left, right) => left.completedSequence - right.completedSequence);
  const assistantMarkdown = completed.map((turn) => turn.parts.join('')).join('\n\n').trim();
  if (!assistantMarkdown) throw sourceError('SOURCE_NO_COMPLETED_TURNS', 'conversation has no completed assistant turn');
  if (Buffer.byteLength(assistantMarkdown, 'utf8') > MAX_MARKDOWN_BYTES) {
    throw sourceError('SOURCE_TOO_LARGE', 'conversation source is too large');
  }
  return {
    conversationId: conversation,
    firstSequence: events[0].sequence,
    lastSequence: events.at(-1).sequence,
    completedTurnCount: completed.length,
    assistantMarkdown,
    contentSha256: crypto.createHash('sha256').update(assistantMarkdown).digest('hex')
  };
}

module.exports = { extractConversationSource };
