'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequirementDraftService } = require('../../src/requirements/requirement-draft-service');

test('submits an explicit bounded draft request only through Gateway and reconciles only that job output', async () => {
  const submissions = []; const created = []; const resolved = [];
  const store = {
    async listFieldTemplates() { return [{ id: 'field-priority', key: 'priority', label: '优先级', type: 'select', options: ['P0', 'P1'], required: false }]; },
    async findRequirementDraftByGatewayJob() { return created.length ? { id: 'draft-1', status: 'generating' } : null; },
    async createRequirementDraft(input) { created.push(input); return { id: 'draft-1', ...input, status: 'generating' }; },
    async getRequirementDraft() { return { id: 'draft-1', ownerUserId: 'owner', gatewayJobId: 'job-1', status: 'generating' }; },
    async resolveRequirementDraft(input) { resolved.push(input); return { id: 'draft-1', status: 'ready', draft: input.draft }; },
    async failRequirementDraft() { throw new Error('should not fail'); }
  };
  const gatewayStore = {
    async listEventsAfter() { return [
      { sequence: 3, type: 'message.created', data: { role: 'user', text: '原始内容' } },
      { sequence: 4, type: 'message.delta', data: { text: '已有回答' } }
    ]; },
    async getJob() { return { id: 'job-1', status: 'completed' }; },
    async listEventsForJob() { return [{ jobId: 'job-1', type: 'message.delta', data: { text: JSON.stringify({ title: 'GPU 扩容', scenario: '训练', description: '评估容量', fieldValues: [{ templateId: 'field-priority', value: 'P1' }], needsClarification: ['确认预算'] }) } }]; }
  };
  const gatewayService = { async submit(input) { submissions.push(input); return { id: 'job-1' }; } };
  const service = createRequirementDraftService({ store, gatewayStore, gatewayService });
  const draft = await service.request({ ownerUserId: 'owner', idempotencyKey: 'draft-key-1', conversationId: 'conv-1', sourceFirstSequence: 3, sourceLastSequence: 4 });
  assert.equal(draft.status, 'generating');
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].conversationId, 'conv-1');
  assert.equal(submissions[0].userId, 'owner');
  assert.match(submissions[0].inputText, /只输出一个 JSON 对象/);
  assert.doesNotMatch(submissions[0].inputText, /原始内容/);
  assert.equal(created[0].sourceFirstSequence, 3);
  assert.equal((await service.request({ ownerUserId: 'owner', idempotencyKey: 'draft-key-1', conversationId: 'conv-1', sourceFirstSequence: 3, sourceLastSequence: 4 })).id, 'draft-1');
  assert.equal(created.length, 1);
  const settled = await service.reconcile({ ownerUserId: 'owner', id: 'draft-1' });
  assert.equal(settled.status, 'ready');
  assert.equal(resolved[0].draft.fieldValues[0].value, 'P1');
});
