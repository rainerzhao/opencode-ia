'use strict';

const crypto = require('node:crypto');
const { normalizeDraftRequest, parseDraftOutput } = require('./requirement-drafts');
const { normalizeFieldValue } = require('./requirement-fields');

function failure(code, message) { const error = new Error(message); error.code = code; return error; }
function validId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value); }
function sourceDigest(events) { return crypto.createHash('sha256').update(JSON.stringify(events.map((event) => ({ sequence: event.sequence, type: event.type, data: event.data })))).digest('hex'); }

function promptFor(templates) {
  const schema = templates.map((item) => ({ templateId: item.id, key: item.key, label: item.label, type: item.type, options: item.options, required: item.required }));
  return [
    '根据当前 OpenCode Conversation 的既有上下文，整理一份“需求草稿”。',
    '只输出一个 JSON 对象，不要 Markdown、代码围栏或解释。',
    '不得补造未知事实；信息不足时填空字符串或空数组，并写入 needsClarification。',
    '输出结构：{"title":string,"scenario":string,"description":string,"fieldValues":[{"templateId":string,"value":unknown}],"needsClarification":[string]}。',
    `允许的受控字段模板：${JSON.stringify(schema)}`
  ].join('\n');
}

function createRequirementDraftService({ store, gatewayStore, gatewayService } = {}) {
  if (!store || !gatewayStore || !gatewayService || typeof gatewayService.submit !== 'function') throw new TypeError('requirement draft service dependencies are required');

  async function request({ ownerUserId, idempotencyKey, ...body } = {}) {
    if (!validId(ownerUserId) || !validId(idempotencyKey)) throw failure('INVALID_REQUIREMENT_DRAFT_REQUEST', 'requirement draft request is invalid');
    const input = normalizeDraftRequest(body);
    const events = await gatewayStore.listEventsAfter({ conversationId: input.conversationId, ownerUserId, afterSequence: input.sourceFirstSequence - 1, limit: input.sourceLastSequence - input.sourceFirstSequence + 1 });
    if (!Array.isArray(events) || events.length !== input.sourceLastSequence - input.sourceFirstSequence + 1 || events.some((event, offset) => event.sequence !== input.sourceFirstSequence + offset)) throw failure('REQUIREMENT_DRAFT_SOURCE_NOT_FOUND', 'requirement draft source was not found');
    const templates = await store.listFieldTemplates({ activeOnly: true });
    const job = await gatewayService.submit({ conversationId: input.conversationId, userId: ownerUserId, idempotencyKey, inputText: promptFor(templates) });
    if (!job || !validId(job.id)) throw failure('GATEWAY_UNAVAILABLE', 'gateway did not accept draft request');
    const existing = await store.findRequirementDraftByGatewayJob({ ownerUserId, gatewayJobId: job.id });
    if (existing) return existing;
    return store.createRequirementDraft({ ownerUserId, sourceConversationId: input.conversationId, sourceFirstSequence: input.sourceFirstSequence, sourceLastSequence: input.sourceLastSequence, sourceSha256: sourceDigest(events), gatewayJobId: job.id });
  }

  async function reconcile({ ownerUserId, id } = {}) {
    if (!validId(ownerUserId) || !validId(id)) throw failure('INVALID_REQUIREMENT_DRAFT', 'requirement draft is invalid');
    const item = await store.getRequirementDraft({ ownerUserId, id });
    if (item.status !== 'generating') return item;
    const job = await gatewayStore.getJob({ id: item.gatewayJobId, userId: ownerUserId });
    if (!job) return store.failRequirementDraft({ ownerUserId, id, errorCode: 'GATEWAY_JOB_NOT_FOUND' });
    if (['queued', 'running'].includes(job.status)) return item;
    if (job.status !== 'completed') return store.failRequirementDraft({ ownerUserId, id, errorCode: job.errorCode || 'GATEWAY_JOB_FAILED' });
    const events = await gatewayStore.listEventsForJob({ id: job.id, userId: ownerUserId });
    const text = (events || []).filter((event) => event.type === 'message.delta' && typeof event.data?.text === 'string').map((event) => event.data.text).join('');
    try {
      const output = parseDraftOutput(text); const templates = await store.listFieldTemplates({ activeOnly: true }); const byId = new Map(templates.map((item) => [item.id, item]));
      for (const entry of output.fieldValues) { const template = byId.get(entry.templateId); if (!template) throw failure('INVALID_REQUIREMENT_DRAFT_OUTPUT', 'requirement draft output is invalid'); normalizeFieldValue(template, entry.value); }
      return store.resolveRequirementDraft({ ownerUserId, id, draft: output });
    } catch {
      return store.failRequirementDraft({ ownerUserId, id, errorCode: 'INVALID_REQUIREMENT_DRAFT_OUTPUT' });
    }
  }

  async function confirm({ ownerUserId, id, ...body } = {}) {
    const current = await reconcile({ ownerUserId, id });
    if (current.status !== 'ready' && current.status !== 'confirmed') throw failure('REQUIREMENT_DRAFT_NOT_READY', 'requirement draft is not ready');
    return store.confirmRequirementDraft({ ownerUserId, id, ...body });
  }

  return Object.freeze({ request, reconcile, confirm });
}

module.exports = { createRequirementDraftService };
