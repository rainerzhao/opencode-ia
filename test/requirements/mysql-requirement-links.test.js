'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createMySqlDatabase } = require('../../src/db/mysql-database');
const { migrateMySqlDatabase } = require('../../src/db/mysql-migrate');
const { createMySqlRequirementStore } = require('../../src/requirements/mysql-requirement-store');
const testUrl = process.env.WORKBENCH_TEST_MYSQL_URL;

test('persists immutable private requirement links on MySQL', { skip: !testUrl }, async (t) => {
  const db = await createMySqlDatabase({ url: testUrl, poolSize: 2 }); await migrateMySqlDatabase(db);
  const suffix = crypto.randomUUID().slice(0, 8); const owner = `links-owner-${suffix}`, other = `links-other-${suffix}`, admin = `links-admin-${suffix}`;
  t.after(async () => {
    await db.query('UPDATE knowledge_documents SET current_version_id = NULL WHERE owner_user_id = ?', [owner]);
    await db.query('DELETE FROM knowledge_versions WHERE document_id = ?', [`knowledge-${suffix}`]);
    await db.query('DELETE FROM knowledge_documents WHERE id = ?', [`knowledge-${suffix}`]);
    await db.query('DELETE FROM users WHERE id IN (?, ?, ?)', [owner, other, admin]); await db.close();
  });
  await db.query(`INSERT INTO users (id, username, display_name, password_hash, role, status, created_at, updated_at) VALUES
    (?, ?, 'Owner', 'hash', 'member', 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)), (?, ?, 'Other', 'hash', 'member', 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)), (?, ?, 'Admin', 'hash', 'admin', 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`, [owner, `links.owner.${suffix}`, other, `links.other.${suffix}`, admin, `links.admin.${suffix}`]);
  let id = 0; const store = createMySqlRequirementStore(db, { idFactory: () => `mysql-link-${suffix}-${++id}`, clock: () => '2026-09-14T00:00:00.000Z' }); const bu = await store.createBusinessUnit({ actorUserId: admin, actorRole: 'admin', name: `关联 BU ${suffix}` }); const requirement = await store.createRequirement({ ownerUserId: owner, title: '关联', buId: bu.id, description: '' });
  await db.query(`INSERT INTO conversations (id, owner_user_id, title, status, created_at, updated_at) VALUES (?, ?, '我的会话', 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)), (?, ?, '他人会话', 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`, [`conversation-${suffix}`, owner, `conversation-other-${suffix}`, other]);
  await db.query(`INSERT INTO knowledge_documents (id, owner_user_id, status, visibility, current_version_id, created_at, updated_at) VALUES (?, ?, 'draft', 'private', NULL, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`, [`knowledge-${suffix}`, owner]);
  await db.query(`INSERT INTO knowledge_versions (id, document_id, version_number, title, category, tags_json, markdown, is_current, current_document_id, created_at, created_by_user_id) VALUES (?, ?, 1, '我的知识', '', JSON_ARRAY(), '# private', 1, ?, UTC_TIMESTAMP(3), ?)`, [`knowledge-version-${suffix}`, `knowledge-${suffix}`, `knowledge-${suffix}`, owner]);
  await db.query('UPDATE knowledge_documents SET current_version_id = ? WHERE id = ?', [`knowledge-version-${suffix}`, `knowledge-${suffix}`]);
  const conversation = await store.addRequirementLink({ ownerUserId: owner, requirementId: requirement.id, resourceType: 'conversation', resourceId: `conversation-${suffix}` }); const knowledge = await store.addRequirementLink({ ownerUserId: owner, requirementId: requirement.id, resourceType: 'knowledge', resourceId: `knowledge-${suffix}` });
  assert.equal(knowledge.versionId, `knowledge-version-${suffix}`); assert.equal((await store.getRequirement({ ownerUserId: owner, id: requirement.id })).links.length, 2);
  await assert.rejects(() => store.addRequirementLink({ ownerUserId: owner, requirementId: requirement.id, resourceType: 'conversation', resourceId: `conversation-other-${suffix}` }), (error) => error.code === 'REQUIREMENT_LINK_TARGET_NOT_FOUND');
  await store.removeRequirementLink({ ownerUserId: owner, requirementId: requirement.id, linkId: conversation.id }); assert.equal((await store.getRequirement({ ownerUserId: owner, id: requirement.id })).links.length, 1);
});
