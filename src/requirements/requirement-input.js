'use strict';

const statuses = new Set(['draft', 'clarifying', 'in_progress', 'resolved', 'archived']);
const channels = new Set(['iim', 'phone', 'meeting', 'manual']);
const { normalizeFieldValueEntries } = require('./requirement-fields');

function invalid() {
  const error = new Error('requirement input is invalid');
  error.code = 'INVALID_REQUIREMENT_INPUT';
  error.status = 400;
  return error;
}

function fields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Object.keys(value).some((key) => !allowed.includes(key))) throw invalid();
}

function text(value, max, { empty = false, multiline = false, preserve = false } = {}) {
  if (typeof value !== 'string') throw invalid();
  const unsafe = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/;
  if ((!empty && !value.trim()) || Array.from(value).length > max || unsafe.test(value)) throw invalid();
  return preserve ? value : value.trim();
}

function identifier(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) throw invalid();
  return value;
}

function status(value) {
  if (!statuses.has(value)) throw invalid();
  return value;
}

function normalizeRequirement(body, { patch = false } = {}) {
  fields(body, ['title', 'buId', 'scenario', 'description', 'status', 'fieldValues']);
  if (patch && !Object.keys(body).length) throw invalid();
  const validators = {
    title: (value) => text(value, 200),
    buId: identifier,
    scenario: (value) => text(value, 100, { empty: true }),
    description: (value) => text(value, 50000, { empty: true, multiline: true }),
    status
  };
  const values = patch ? body : { scenario: '', description: '', status: 'draft', ...body };
  if (!patch && (!Object.hasOwn(values, 'title') || !Object.hasOwn(values, 'buId'))) throw invalid();
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, key === 'fieldValues' ? normalizeFieldValueEntries(value) : validators[key](value)]));
}

function timestamp(value) {
  // Date.parse alone silently rolls invalid days into the next month.
  if (typeof value !== 'string') throw invalid();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw invalid();
  const [, y, m, d, h, min, sec, zone] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > days
    || Number(h) > 23 || Number(min) > 59 || Number(sec) > 59
    || (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))) throw invalid();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.getUTCFullYear() < 1000 || parsed.getUTCFullYear() > 9999) throw invalid();
  return parsed.toISOString();
}

function normalizeInteraction(body) {
  fields(body, ['channel', 'content', 'occurredAt']);
  if (!channels.has(body.channel)) throw invalid();
  return {
    channel: body.channel,
    content: text(body.content, 50000, { multiline: true, preserve: true }),
    occurredAt: timestamp(body.occurredAt)
  };
}

function integer(value, fallback, min, max) {
  if (value === undefined) return fallback;
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^\d+$/.test(String(value))) throw invalid();
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw invalid();
  return number;
}

function normalizeRequirementQuery(query = {}) {
  fields(query, ['limit', 'offset', 'q', 'buId', 'status']);
  return {
    limit: integer(query.limit, 20, 1, 100),
    offset: integer(query.offset, 0, 0, 1000000),
    query: query.q === undefined ? '' : text(query.q, 200, { empty: true }),
    ...(Object.hasOwn(query, 'buId') ? { buId: identifier(query.buId) } : {}),
    ...(Object.hasOwn(query, 'status') ? { status: status(query.status) } : {})
  };
}

module.exports = { normalizeRequirement, normalizeInteraction, normalizeRequirementQuery };
