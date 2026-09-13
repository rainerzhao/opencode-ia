'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../../src/db/open-database');
const { migrateDatabase } = require('../../src/db/migrate');
let createRequirementStore;
try { ({ createRequirementStore } = require('../../src/requirements/requirement-store')); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }

function setup() {
  const db = openDatabase({ filename: ':memory:' });
  migrateDatabase(db);
  db.prepare(`INSERT INTO users (id, username, display_name, password_hash, role, status, created_at, updated_at)
    VALUES ('owner', 'owner', 'Owner', 'hash', 'member', 'active', '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z'),
      ('other', 'other', 'Other', 'hash', 'member', 'active', '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z'),
      ('admin', 'admin', 'Admin', 'hash', 'admin', 'active', '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z')`).run();
  let id = 0;
  return { db, store: createRequirementStore(db, { idFactory: () => `req-${++id}`, clock: () => '2026-09-13T00:00:00.000Z' }) };
}

test('requirements are private to their owner including administrators', () => {
  assert.equal(typeof createRequirementStore, 'function');
  const { db, store } = setup();
  const bu = store.createBusinessUnit({ actorUserId: 'admin', actorRole: 'admin', name: '基础设施 BU' });
  const requirement = store.createRequirement({ ownerUserId: 'owner', title: 'GPU 集群扩容', buId: bu.id, scenario: '训练', description: '需要评估容量' });
  assert.equal(requirement.ownerUserId, 'owner');
  assert.equal(requirement.responsibleUserId, 'owner');
  assert.equal(requirement.status, 'draft');
  assert.equal(store.getRequirement({ ownerUserId: 'owner', id: requirement.id }).description, '需要评估容量');
  for (const ownerUserId of ['other', 'admin']) {
    assert.throws(() => store.getRequirement({ ownerUserId, id: requirement.id }), { code: 'REQUIREMENT_NOT_FOUND' });
    assert.deepEqual(store.listRequirements({ ownerUserId, query: 'GPU' }).items, []);
  }
  db.close();
});

test('persists original interactions, updates only the owner record, and filters without leaking other records', () => {
  const { db, store } = setup();
  const bu = store.createBusinessUnit({ actorUserId: 'admin', actorRole: 'admin', name: '行业 BU' });
  const requirement = store.createRequirement({ ownerUserId: 'owner', title: '容灾方案', buId: bu.id, description: '原始需求' });
  const interaction = store.addInteraction({ ownerUserId: 'owner', requirementId: requirement.id, channel: 'phone', content: '  电话纪要原文\n', occurredAt: '2026-09-13T02:30:00.000Z' });
  assert.equal(interaction.content, '  电话纪要原文\n');
  const updated = store.updateRequirement({ ownerUserId: 'owner', id: requirement.id, status: 'clarifying', title: '容灾方案（待澄清）' });
  assert.equal(updated.status, 'clarifying');
  const detail = store.getRequirement({ ownerUserId: 'owner', id: requirement.id });
  assert.equal(detail.interactions.length, 1);
  assert.equal(detail.interactions[0].id, interaction.id);
  assert.deepEqual(store.listRequirements({ ownerUserId: 'owner', query: '澄清', limit: 1, offset: 0 }).items.map((item) => item.id), [requirement.id]);
  assert.throws(() => store.addInteraction({ ownerUserId: 'other', requirementId: requirement.id, channel: 'manual', content: 'bad', occurredAt: '2026-09-13T02:30:00.000Z' }), { code: 'REQUIREMENT_NOT_FOUND' });
  db.close();
});

test('rejects non-admin BU changes and archiving a BU that still has active requirements', () => {
  const { db, store } = setup();
  assert.throws(() => store.createBusinessUnit({ actorUserId: 'owner', actorRole: 'member', name: 'Private BU' }), { code: 'BUSINESS_UNIT_NOT_FOUND' });
  const bu = store.createBusinessUnit({ actorUserId: 'admin', actorRole: 'admin', name: '云 BU' });
  const requirement = store.createRequirement({ ownerUserId: 'owner', title: '迁移', buId: bu.id, description: '' });
  assert.throws(() => store.archiveBusinessUnit({ actorUserId: 'admin', actorRole: 'admin', id: bu.id }), { code: 'BUSINESS_UNIT_IN_USE' });
  store.updateRequirement({ ownerUserId: 'owner', id: requirement.id, status: 'archived' });
  assert.equal(store.archiveBusinessUnit({ actorUserId: 'admin', actorRole: 'admin', id: bu.id }).status, 'archived');
  assert.deepEqual(store.listBusinessUnits({ activeOnly: true }), []);
  db.close();
});

test('only administrators govern templates and requirement values stay owner-private with their schema version', () => {
  const { db, store } = setup();
  const template = store.createFieldTemplate({
    actorUserId: 'admin', actorRole: 'admin', key: 'priority', label: '优先级', type: 'select', options: ['P0', 'P1'], required: true
  });
  assert.equal(template.schemaVersion, 1);
  assert.throws(() => store.createFieldTemplate({ actorUserId: 'owner', actorRole: 'member', key: 'region', label: '区域', type: 'text' }), { code: 'REQUIREMENT_FIELD_TEMPLATE_NOT_FOUND' });
  const bu = store.createBusinessUnit({ actorUserId: 'admin', actorRole: 'admin', name: '字段 BU' });
  assert.throws(() => store.createRequirement({ ownerUserId: 'owner', title: '缺少必填字段', buId: bu.id }), { code: 'REQUIRED_REQUIREMENT_FIELD_VALUE' });
  const requirement = store.createRequirement({ ownerUserId: 'owner', title: '受控字段', buId: bu.id, fieldValues: [{ templateId: template.id, value: 'P1' }] });
  const detail = store.getRequirement({ ownerUserId: 'owner', id: requirement.id });
  assert.deepEqual(detail.fieldValues, [{ templateId: template.id, key: 'priority', label: '优先级', type: 'select', schemaVersion: 1, value: 'P1' }]);
  assert.throws(() => store.updateRequirement({ ownerUserId: 'owner', id: requirement.id, fieldValues: [{ templateId: template.id, value: 'P2' }] }), { code: 'INVALID_REQUIREMENT_FIELD_VALUE' });
  assert.throws(() => store.getRequirement({ ownerUserId: 'other', id: requirement.id }), { code: 'REQUIREMENT_NOT_FOUND' });
  assert.equal(store.archiveFieldTemplate({ actorUserId: 'admin', actorRole: 'admin', id: template.id }).status, 'archived');
  assert.throws(() => store.updateRequirement({ ownerUserId: 'owner', id: requirement.id, fieldValues: [{ templateId: template.id, value: 'P0' }] }), { code: 'REQUIREMENT_FIELD_TEMPLATE_NOT_FOUND' });
  assert.equal(store.getRequirement({ ownerUserId: 'owner', id: requirement.id }).fieldValues[0].value, 'P1');
  db.close();
});

test('keeps an OpenCode requirement draft private and records confirmation separately from its source', () => {
  const { db, store } = setup();
  db.prepare(`INSERT INTO conversations (id, owner_user_id, title, status, created_at, updated_at) VALUES ('conv-1', 'owner', '原始沟通', 'active', '2026-09-14T00:00:00.000Z', '2026-09-14T00:00:00.000Z')`).run();
  db.prepare(`INSERT INTO gateway_jobs (id, conversation_id, user_id, idempotency_key, input_text, status, created_at, updated_at) VALUES ('job-1', 'conv-1', 'owner', 'draft-1', '整理需求', 'completed', '2026-09-14T00:00:00.000Z', '2026-09-14T00:00:00.000Z')`).run();
  const draft = store.createRequirementDraft({ ownerUserId: 'owner', sourceConversationId: 'conv-1', sourceFirstSequence: 1, sourceLastSequence: 4, sourceSha256: 'a'.repeat(64), gatewayJobId: 'job-1' });
  assert.equal(draft.status, 'generating');
  assert.throws(() => store.getRequirementDraft({ ownerUserId: 'other', id: draft.id }), { code: 'REQUIREMENT_DRAFT_NOT_FOUND' });
  const ready = store.resolveRequirementDraft({ ownerUserId: 'owner', id: draft.id, draft: { title: '需求', scenario: '', description: '', fieldValues: [], needsClarification: ['确认范围'] } });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.sourceConversationId, 'conv-1');
  assert.equal(ready.draft.needsClarification[0], '确认范围');
  assert.equal(store.rejectRequirementDraft({ ownerUserId: 'owner', id: draft.id }).status, 'rejected');
  db.close();
});

test('confirms a ready draft exactly once by creating a private requirement through normal validation', () => {
  const { db, store } = setup();
  const bu = store.createBusinessUnit({ actorUserId: 'admin', actorRole: 'admin', name: '确认 BU' });
  db.prepare(`INSERT INTO conversations (id, owner_user_id, title, status, created_at, updated_at) VALUES ('conv-confirm', 'owner', '对话', 'active', '2026-09-14T00:00:00.000Z', '2026-09-14T00:00:00.000Z')`).run();
  db.prepare(`INSERT INTO gateway_jobs (id, conversation_id, user_id, idempotency_key, input_text, status, created_at, updated_at) VALUES ('job-confirm', 'conv-confirm', 'owner', 'draft-confirm', '整理需求', 'completed', '2026-09-14T00:00:00.000Z', '2026-09-14T00:00:00.000Z')`).run();
  const draft = store.createRequirementDraft({ ownerUserId: 'owner', sourceConversationId: 'conv-confirm', sourceFirstSequence: 1, sourceLastSequence: 1, sourceSha256: 'b'.repeat(64), gatewayJobId: 'job-confirm' });
  store.resolveRequirementDraft({ ownerUserId: 'owner', id: draft.id, draft: { title: 'AI 草稿', scenario: '', description: '待确认', fieldValues: [], needsClarification: [] } });
  const first = store.confirmRequirementDraft({ ownerUserId: 'owner', id: draft.id, buId: bu.id });
  assert.equal(first.requirement.title, 'AI 草稿');
  assert.equal(first.draft.status, 'confirmed');
  assert.equal(store.confirmRequirementDraft({ ownerUserId: 'owner', id: draft.id, buId: bu.id }).requirement.id, first.requirement.id);
  assert.equal(store.listRequirements({ ownerUserId: 'owner' }).total, 1);
  db.close();
});
