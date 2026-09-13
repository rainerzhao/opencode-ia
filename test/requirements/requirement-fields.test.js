'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeFieldTemplate, normalizeFieldValue, normalizeFieldValueEntries } = require('../../src/requirements/requirement-fields');

test('normalizes a versioned controlled select template and accepts its declared option only', () => {
  const template = normalizeFieldTemplate({
    key: 'priority', label: '优先级', type: 'select', options: ['P0', 'P1'], required: true
  });
  assert.deepEqual(template, {
    key: 'priority', label: '优先级', type: 'select', options: ['P0', 'P1'], required: true
  });
  assert.deepEqual(normalizeFieldValue(template, 'P1'), 'P1');
  assert.throws(() => normalizeFieldValue(template, 'P2'), { code: 'INVALID_REQUIREMENT_FIELD_VALUE' });
});

test('rejects ambiguous schema and validates each controlled value type', () => {
  assert.throws(() => normalizeFieldTemplate({ key: ' bad key ', label: 'Bad', type: 'text' }), { code: 'INVALID_REQUIREMENT_FIELD_TEMPLATE' });
  assert.throws(() => normalizeFieldTemplate({ key: 'stage', label: '阶段', type: 'select', options: ['same', 'same'] }), { code: 'INVALID_REQUIREMENT_FIELD_TEMPLATE' });
  assert.equal(normalizeFieldValue({ type: 'number' }, 20), 20);
  assert.equal(normalizeFieldValue({ type: 'boolean' }, false), false);
  assert.throws(() => normalizeFieldValue({ type: 'number' }, '20'), { code: 'INVALID_REQUIREMENT_FIELD_VALUE' });
  assert.throws(() => normalizeFieldValue({ type: 'text' }, 'x'.repeat(5001)), { code: 'INVALID_REQUIREMENT_FIELD_VALUE' });
});

test('rejects duplicate template values before storage', () => {
  assert.throws(() => normalizeFieldValueEntries([
    { templateId: 'field-1', value: 'A' },
    { templateId: 'field-1', value: 'B' }
  ]), { code: 'INVALID_REQUIREMENT_FIELD_VALUES' });
});
