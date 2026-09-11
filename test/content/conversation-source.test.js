'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { extractConversationSource } = require('../../src/content/conversation-source');

function event(sequence, jobId, type, data) {
  return { sequence, conversationId: 'conversation-1', jobId, type, data };
}

test('extracts only completed assistant turns with a bounded source range and digest', () => {
  const result = extractConversationSource({
    conversationId: 'conversation-1',
    events: [
      event(1, 'job-1', 'message.created', { role: 'user', text: '第一轮需求' }),
      event(2, 'job-1', 'job.started', { status: 'running' }),
      event(3, 'job-1', 'message.delta', { text: '第一轮方案' }),
      event(4, 'job-1', 'job.completed', { status: 'completed' }),
      event(5, 'job-2', 'message.created', { role: 'user', text: '第二轮需求' }),
      event(6, 'job-2', 'message.delta', { text: '未完成内容' }),
      event(7, 'job-2', 'job.failed', { status: 'failed' }),
      event(8, 'job-3', 'message.created', { role: 'user', text: '第三轮需求' }),
      event(9, 'job-3', 'message.delta', { text: '第三轮方案 A' }),
      event(10, 'job-3', 'message.delta', { text: '第三轮方案 B' }),
      event(11, 'job-3', 'job.completed', { status: 'completed' })
    ]
  });

  const markdown = '第一轮方案\n\n第三轮方案 A第三轮方案 B';
  assert.deepEqual(result, {
    conversationId: 'conversation-1',
    firstSequence: 1,
    lastSequence: 11,
    completedTurnCount: 2,
    assistantMarkdown: markdown,
    contentSha256: crypto.createHash('sha256').update(markdown).digest('hex')
  });
});

test('rejects a source with no completed assistant turn without exposing event content', () => {
  assert.throws(
    () => extractConversationSource({
      conversationId: 'conversation-1',
      events: [event(1, 'job-1', 'message.created', { role: 'user', text: 'secret input' })]
    }),
    (error) => error.code === 'SOURCE_NO_COMPLETED_TURNS' && !error.message.includes('secret input')
  );
});

test('rejects malformed or cross-conversation event ranges', () => {
  assert.throws(
    () => extractConversationSource({ conversationId: 'conversation-1', events: [{ sequence: 1, conversationId: 'other', type: 'job.completed', data: {} }] }),
    (error) => error.code === 'SOURCE_EVENT_CONVERSATION_MISMATCH'
  );
  assert.throws(
    () => extractConversationSource({ conversationId: 'conversation-1', events: [{ sequence: 0, conversationId: 'conversation-1', type: 'job.completed', data: {} }] }),
    (error) => error.code === 'SOURCE_EVENT_INVALID'
  );
});
