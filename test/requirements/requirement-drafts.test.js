'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDraftRequest, parseDraftOutput } = require('../../src/requirements/requirement-drafts');

test('bounds an explicit source range without accepting a synthetic conversation id', () => {
  assert.deepEqual(normalizeDraftRequest({ conversationId: 'conversation-1', sourceFirstSequence: 3, sourceLastSequence: 8 }), {
    conversationId: 'conversation-1', sourceFirstSequence: 3, sourceLastSequence: 8
  });
  assert.throws(() => normalizeDraftRequest({ conversationId: 'conversation-1', sourceFirstSequence: 8, sourceLastSequence: 3 }), { code: 'INVALID_REQUIREMENT_DRAFT_REQUEST' });
});

test('accepts only a structured draft with explicit missing-information questions', () => {
  const output = parseDraftOutput(JSON.stringify({
    title: 'GPU 扩容需求', scenario: '训练', description: '评估明年训练集群容量',
    fieldValues: [{ templateId: 'field-priority', value: 'P1' }], needsClarification: ['请确认上线时间']
  }));
  assert.deepEqual(output, {
    title: 'GPU 扩容需求', scenario: '训练', description: '评估明年训练集群容量',
    fieldValues: [{ templateId: 'field-priority', value: 'P1' }], needsClarification: ['请确认上线时间']
  });
  assert.throws(() => parseDraftOutput('```json\n{}\n```'), { code: 'INVALID_REQUIREMENT_DRAFT_OUTPUT' });
});
