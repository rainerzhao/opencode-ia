'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractAttachmentText } = require('../../src/content/attachment-parser');

test('parses bounded UTF-8 text and normalizes JSON for preview', () => {
  assert.deepEqual(extractAttachmentText({ originalName: 'guide.md', content: Buffer.from('# 标题\n正文', 'utf8') }), {
    format: 'md', truncated: false, text: '# 标题\n正文'
  });
  assert.equal(extractAttachmentText({ originalName: 'data.json', content: Buffer.from('{"ok":true}', 'utf8') }).text, '{\n  "ok": true\n}\n');
});

test('rejects invalid text, unsupported binary formats and oversized previews', () => {
  assert.throws(() => extractAttachmentText({ originalName: 'bad.json', content: Buffer.from('{bad}', 'utf8') }), /JSON is invalid/);
  assert.throws(() => extractAttachmentText({ originalName: 'manual.pdf', content: Buffer.from('%PDF') }), /cannot be previewed/);
  const parsed = extractAttachmentText({ originalName: 'notes.txt', content: Buffer.from('abcdef', 'utf8'), maxBytes: 3 });
  assert.equal(parsed.truncated, true);
  assert.equal(parsed.text, 'abc');
  assert.throws(() => extractAttachmentText({ originalName: 'notes.txt', content: Buffer.from([0xff]) }), /UTF-8/);
});
