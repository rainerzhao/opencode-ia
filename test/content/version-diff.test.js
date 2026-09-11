'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { diffText } = require('../../src/content/version-diff');

test('produces deterministic line changes with counts', () => {
  const result = diffText('标题\n保留\n旧行', '标题\n保留\n新行\n新增');
  assert.deepEqual(result.summary, { additions: 2, removals: 1, unchanged: 2 });
  assert.deepEqual(result.hunks, [
    { type: 'equal', lines: ['标题', '保留'] },
    { type: 'remove', lines: ['旧行'] },
    { type: 'add', lines: ['新行', '新增'] }
  ]);
});

test('normalizes empty text and rejects oversized input', () => {
  assert.deepEqual(diffText('', ''), { summary: { additions: 0, removals: 0, unchanged: 1 }, hunks: [{ type: 'equal', lines: [''] }] });
  assert.throws(() => diffText('a'.repeat(1024 * 1024 + 1), 'b'), /version diff is too large/);
});
