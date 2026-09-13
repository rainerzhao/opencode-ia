'use strict';

const { normalizeFieldValueEntries } = require('./requirement-fields');

function failure(code, message) { const error = new Error(message); error.code = code; return error; }
function validId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value); }
function safeText(value, max, { empty = false, multiline = false } = {}) {
  if (typeof value !== 'string' || (!empty && !value.trim()) || Array.from(value).length > max || (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value)) return null;
  return value.trim();
}

function normalizeDraftRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !['conversationId', 'sourceFirstSequence', 'sourceLastSequence'].includes(key)) || !validId(input.conversationId) || !Number.isSafeInteger(input.sourceFirstSequence) || !Number.isSafeInteger(input.sourceLastSequence) || input.sourceFirstSequence < 1 || input.sourceLastSequence < input.sourceFirstSequence || input.sourceLastSequence - input.sourceFirstSequence >= 1000) throw failure('INVALID_REQUIREMENT_DRAFT_REQUEST', 'requirement draft request is invalid');
  return { conversationId: input.conversationId, sourceFirstSequence: input.sourceFirstSequence, sourceLastSequence: input.sourceLastSequence };
}

function parseDraftOutput(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 100000) throw failure('INVALID_REQUIREMENT_DRAFT_OUTPUT', 'requirement draft output is invalid');
  let value;
  try { value = JSON.parse(text); } catch { throw failure('INVALID_REQUIREMENT_DRAFT_OUTPUT', 'requirement draft output is invalid'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !['title', 'scenario', 'description', 'fieldValues', 'needsClarification'].includes(key))) throw failure('INVALID_REQUIREMENT_DRAFT_OUTPUT', 'requirement draft output is invalid');
  const title = safeText(value.title, 200); const scenario = safeText(value.scenario, 100, { empty: true }); const description = safeText(value.description, 50000, { empty: true, multiline: true });
  if (title === null || scenario === null || description === null || !Array.isArray(value.needsClarification) || value.needsClarification.length > 30 || value.needsClarification.some((item) => safeText(item, 500) === null)) throw failure('INVALID_REQUIREMENT_DRAFT_OUTPUT', 'requirement draft output is invalid');
  let fieldValues;
  try { fieldValues = normalizeFieldValueEntries(value.fieldValues); } catch { throw failure('INVALID_REQUIREMENT_DRAFT_OUTPUT', 'requirement draft output is invalid'); }
  if (fieldValues === undefined) throw failure('INVALID_REQUIREMENT_DRAFT_OUTPUT', 'requirement draft output is invalid');
  return { title, scenario, description, fieldValues, needsClarification: value.needsClarification.map((item) => item.trim()) };
}

module.exports = { normalizeDraftRequest, parseDraftOutput };
