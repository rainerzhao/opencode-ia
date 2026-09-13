'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMySqlDatabase } = require('../../src/db/mysql-database');
const { migrateMySqlDatabase } = require('../../src/db/mysql-migrate');
const { createMySqlRequirementStore } = require('../../src/requirements/mysql-requirement-store');
const testUrl = process.env.WORKBENCH_TEST_MYSQL_URL;

test('persists private requirements and original communication records on MySQL', { skip: !testUrl }, async (t) => {
  const db = await createMySqlDatabase({ url: testUrl, poolSize: 2 }); await migrateMySqlDatabase(db);
  const suffix = Date.now().toString(36); const owner = `req-owner-${suffix}`, other = `req-other-${suffix}`, admin = `req-admin-${suffix}`;
  t.after(async () => { await db.query('DELETE FROM users WHERE id IN (?, ?, ?)', [owner, other, admin]); await db.close(); });
  await db.query(`INSERT INTO users (id, username, display_name, password_hash, role, status, created_at, updated_at) VALUES
    (?, ?, 'Owner', 'hash', 'member', 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)), (?, ?, 'Other', 'hash', 'member', 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)), (?, ?, 'Admin', 'hash', 'admin', 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`, [owner, `req.owner.${suffix}`, other, `req.other.${suffix}`, admin, `req.admin.${suffix}`]);
  let serial = 0; const store = createMySqlRequirementStore(db, { idFactory: () => `mysql-req-${suffix}-${++serial}`, clock: () => '2026-09-13T00:00:00.000Z' });
  const bu = await store.createBusinessUnit({ actorUserId: admin, actorRole: 'admin', name: `云 BU ${suffix}` });
  const requirement = await store.createRequirement({ ownerUserId: owner, title: '内网迁移', buId: bu.id, scenario: '云迁移', description: '原始需求' }); assert.equal(requirement.responsibleUserId, owner);
  await store.addInteraction({ ownerUserId: owner, requirementId: requirement.id, channel: 'iim', content: 'IIM 原文', occurredAt: '2026-09-13T02:30:00.000Z' });
  await assert.rejects(() => store.getRequirement({ ownerUserId: other, id: requirement.id }), (error) => error.code === 'REQUIREMENT_NOT_FOUND');
  await assert.rejects(() => store.getRequirement({ ownerUserId: admin, id: requirement.id }), (error) => error.code === 'REQUIREMENT_NOT_FOUND');
  const detail = await store.getRequirement({ ownerUserId: owner, id: requirement.id }); assert.equal(detail.interactions[0].content, 'IIM 原文');
  assert.deepEqual((await store.listRequirements({ ownerUserId: owner, query: '迁移' })).items.map((item) => item.id), [requirement.id]);
});

test('persists versioned private field values on MySQL and refuses archived templates', { skip: !testUrl }, async (t) => {
  const db = await createMySqlDatabase({ url: testUrl, poolSize: 2 }); await migrateMySqlDatabase(db);
  const suffix = Date.now().toString(36); const owner = `field-owner-${suffix}`, admin = `field-admin-${suffix}`;
  t.after(async () => { await db.query('DELETE FROM users WHERE id IN (?, ?)', [owner, admin]); await db.close(); });
  await db.query(`INSERT INTO users (id, username, display_name, password_hash, role, status, created_at, updated_at) VALUES
    (?, ?, 'Owner', 'hash', 'member', 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)), (?, ?, 'Admin', 'hash', 'admin', 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`, [owner, `field.owner.${suffix}`, admin, `field.admin.${suffix}`]);
  let serial = 0; const store = createMySqlRequirementStore(db, { idFactory: () => `mysql-field-${suffix}-${++serial}`, clock: () => '2026-09-14T00:00:00.000Z' });
  const bu = await store.createBusinessUnit({ actorUserId: admin, actorRole: 'admin', name: `字段 BU ${suffix}` });
  const field = await store.createFieldTemplate({ actorUserId: admin, actorRole: 'admin', key: `priority_${suffix}`.slice(0, 64), label: '优先级', type: 'select', options: ['P0', 'P1'], required: false });
  const requirement = await store.createRequirement({ ownerUserId: owner, title: '字段需求', buId: bu.id, fieldValues: [{ templateId: field.id, value: 'P0' }] });
  assert.deepEqual((await store.getRequirement({ ownerUserId: owner, id: requirement.id })).fieldValues.map((value) => ({ key: value.key, value: value.value, schemaVersion: value.schemaVersion })), [{ key: field.key, value: 'P0', schemaVersion: 1 }]);
  await store.archiveFieldTemplate({ actorUserId: admin, actorRole: 'admin', id: field.id });
  await assert.rejects(() => store.updateRequirement({ ownerUserId: owner, id: requirement.id, fieldValues: [{ templateId: field.id, value: 'P1' }] }), (error) => error.code === 'REQUIREMENT_FIELD_TEMPLATE_NOT_FOUND');
});

test('keeps OpenCode draft confirmation private and idempotent on MySQL', { skip: !testUrl }, async (t) => {
  const db = await createMySqlDatabase({ url: testUrl, poolSize: 2 }); await migrateMySqlDatabase(db);
  const suffix = Date.now().toString(36); const owner = `draft-owner-${suffix}`, admin = `draft-admin-${suffix}`;
  t.after(async () => { await db.query('DELETE FROM users WHERE id IN (?, ?)', [owner, admin]); await db.close(); });
  await db.query(`INSERT INTO users (id, username, display_name, password_hash, role, status, created_at, updated_at) VALUES (?, ?, 'Owner', 'hash', 'member', 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)), (?, ?, 'Admin', 'hash', 'admin', 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`, [owner, `draft.owner.${suffix}`, admin, `draft.admin.${suffix}`]);
  let serial = 0; const store = createMySqlRequirementStore(db, { idFactory: () => `mysql-draft-${suffix}-${++serial}`, clock: () => '2026-09-14T00:00:00.000Z' });
  const bu = await store.createBusinessUnit({ actorUserId: admin, actorRole: 'admin', name: `草稿 BU ${suffix}` });
  await db.query("INSERT INTO conversations (id, owner_user_id, title, status, created_at, updated_at) VALUES (?, ?, '沟通', 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))", [`conv-${suffix}`, owner]);
  await db.query("INSERT INTO gateway_jobs (id, conversation_id, user_id, idempotency_key, input_text, status, created_at, updated_at) VALUES (?, ?, ?, 'draft', '整理', 'completed', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))", [`job-${suffix}`, `conv-${suffix}`, owner]);
  const draft = await store.createRequirementDraft({ ownerUserId: owner, sourceConversationId: `conv-${suffix}`, sourceFirstSequence: 1, sourceLastSequence: 1, sourceSha256: 'c'.repeat(64), gatewayJobId: `job-${suffix}` });
  await store.resolveRequirementDraft({ ownerUserId: owner, id: draft.id, draft: { title: '草稿', scenario: '', description: '', fieldValues: [], needsClarification: [] } });
  const first = await store.confirmRequirementDraft({ ownerUserId: owner, id: draft.id, buId: bu.id }); const second = await store.confirmRequirementDraft({ ownerUserId: owner, id: draft.id, buId: bu.id });
  assert.equal(first.draft.status, 'confirmed'); assert.equal(first.requirement.id, second.requirement.id);
});
