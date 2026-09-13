'use strict';

function failure(code, message) { const error = new Error(message); error.code = code; return error; }

function isPlainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function validKey(value) { return typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(value); }
function validIdentifier(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value); }
function validText(value, max) { return typeof value === 'string' && value.trim() !== '' && Array.from(value).length <= max && !/[\u0000-\u001f\u007f]/.test(value); }

function normalizeFieldTemplate(input, { patch = false } = {}) {
  if (!isPlainObject(input)) throw failure('INVALID_REQUIREMENT_FIELD_TEMPLATE', 'requirement field template is invalid');
  const allowed = new Set(['key', 'label', 'type', 'options', 'required']);
  if (Object.keys(input).some((key) => !allowed.has(key))) throw failure('INVALID_REQUIREMENT_FIELD_TEMPLATE', 'requirement field template is invalid');
  const result = {};
  if (Object.hasOwn(input, 'key')) {
    if (!validKey(input.key)) throw failure('INVALID_REQUIREMENT_FIELD_TEMPLATE', 'requirement field template is invalid');
    result.key = input.key;
  } else if (!patch) throw failure('INVALID_REQUIREMENT_FIELD_TEMPLATE', 'requirement field template is invalid');
  if (Object.hasOwn(input, 'label')) {
    if (!validText(input.label, 100)) throw failure('INVALID_REQUIREMENT_FIELD_TEMPLATE', 'requirement field template is invalid');
    result.label = input.label.trim();
  } else if (!patch) throw failure('INVALID_REQUIREMENT_FIELD_TEMPLATE', 'requirement field template is invalid');
  if (Object.hasOwn(input, 'type')) {
    if (!['text', 'number', 'select', 'boolean'].includes(input.type)) throw failure('INVALID_REQUIREMENT_FIELD_TEMPLATE', 'requirement field template is invalid');
    result.type = input.type;
  } else if (!patch) throw failure('INVALID_REQUIREMENT_FIELD_TEMPLATE', 'requirement field template is invalid');
  if (Object.hasOwn(input, 'options')) {
    if (!Array.isArray(input.options) || input.options.length > 50 || input.options.some((item) => !validText(item, 100)) || new Set(input.options).size !== input.options.length) throw failure('INVALID_REQUIREMENT_FIELD_TEMPLATE', 'requirement field template is invalid');
    result.options = input.options.map((item) => item.trim());
  } else if (!patch) {
    result.options = [];
  }
  if (Object.hasOwn(input, 'required')) {
    if (typeof input.required !== 'boolean') throw failure('INVALID_REQUIREMENT_FIELD_TEMPLATE', 'requirement field template is invalid');
    result.required = input.required;
  } else if (!patch) {
    result.required = false;
  }
  if (!patch && result.type === 'select' && result.options.length === 0) throw failure('INVALID_REQUIREMENT_FIELD_TEMPLATE', 'requirement field template is invalid');
  if (!patch && result.type !== 'select' && result.options.length !== 0) throw failure('INVALID_REQUIREMENT_FIELD_TEMPLATE', 'requirement field template is invalid');
  return result;
}

function normalizeFieldValue(template, value) {
  if (!template || !['text', 'number', 'select', 'boolean'].includes(template.type)) throw failure('INVALID_REQUIREMENT_FIELD_VALUE', 'requirement field value is invalid');
  if (template.type === 'text') {
    if (!validText(value, 5000)) throw failure('INVALID_REQUIREMENT_FIELD_VALUE', 'requirement field value is invalid');
    return value;
  }
  if (template.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw failure('INVALID_REQUIREMENT_FIELD_VALUE', 'requirement field value is invalid');
    return value;
  }
  if (template.type === 'select') {
    if (typeof value !== 'string' || !Array.isArray(template.options) || !template.options.includes(value)) throw failure('INVALID_REQUIREMENT_FIELD_VALUE', 'requirement field value is invalid');
    return value;
  }
  if (typeof value !== 'boolean') throw failure('INVALID_REQUIREMENT_FIELD_VALUE', 'requirement field value is invalid');
  return value;
}

function normalizeFieldValueEntries(input) {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || input.length > 100) throw failure('INVALID_REQUIREMENT_FIELD_VALUES', 'requirement field values are invalid');
  const seen = new Set();
  return input.map((entry) => {
    if (!isPlainObject(entry) || !validIdentifier(entry.templateId) || !Object.hasOwn(entry, 'value') || seen.has(entry.templateId)) throw failure('INVALID_REQUIREMENT_FIELD_VALUES', 'requirement field values are invalid');
    seen.add(entry.templateId);
    return { templateId: entry.templateId, value: entry.value };
  });
}

module.exports = { normalizeFieldTemplate, normalizeFieldValue, normalizeFieldValueEntries };
