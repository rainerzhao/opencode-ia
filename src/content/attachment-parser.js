'use strict';

const path = require('node:path');

const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.json', '.csv']);
const MAX_PREVIEW_BYTES = 1 * 1024 * 1024;

function parserError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function extractAttachmentText({ originalName, content, maxBytes = MAX_PREVIEW_BYTES }) {
  if (typeof originalName !== 'string' || !Buffer.isBuffer(content)) {
    throw parserError('ATTACHMENT_PARSE_INVALID', 'attachment content is invalid');
  }
  const extension = path.extname(originalName).toLowerCase();
  if (!TEXT_EXTENSIONS.has(extension)) {
    throw parserError('ATTACHMENT_PARSE_UNSUPPORTED', 'attachment type cannot be previewed');
  }
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_PREVIEW_BYTES) {
    throw parserError('ATTACHMENT_PARSE_INVALID', 'attachment preview limit is invalid');
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    throw parserError('ATTACHMENT_PARSE_INVALID', 'attachment is not valid UTF-8 text');
  }
  if (text.includes('\0')) throw parserError('ATTACHMENT_PARSE_INVALID', 'attachment contains invalid control characters');
  if (extension === '.json') {
    try { text = `${JSON.stringify(JSON.parse(text), null, 2)}\n`; }
    catch { throw parserError('ATTACHMENT_PARSE_INVALID', 'attachment JSON is invalid'); }
  }
  const truncated = Buffer.byteLength(text, 'utf8') > maxBytes;
  if (truncated) {
    let end = Math.min(text.length, maxBytes);
    while (end > 0 && Buffer.byteLength(text.slice(0, end), 'utf8') > maxBytes) end -= 1;
    text = text.slice(0, end);
  }
  return { text, truncated, format: extension.slice(1) };
}

module.exports = { extractAttachmentText, MAX_PREVIEW_BYTES };
