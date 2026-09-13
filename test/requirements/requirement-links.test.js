'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../../src/db/open-database');
const { migrateDatabase } = require('../../src/db/migrate');
const { createRequirementStore } = require('../../src/requirements/requirement-store');

function fixture() {
  const db = openDatabase({ filename: ':memory:' }); migrateDatabase(db);
  db.prepare(`INSERT INTO users (id, username, display_name, password_hash, role, status, created_at, updated_at) VALUES
    ('owner', 'owner', 'Owner', 'hash', 'member', 'active', '2026-09-14T00:00:00.000Z', '2026-09-14T00:00:00.000Z'),
    ('other', 'other', 'Other', 'hash', 'member', 'active', '2026-09-14T00:00:00.000Z', '2026-09-14T00:00:00.000Z'),
    ('admin', 'admin', 'Admin', 'hash', 'admin', 'active', '2026-09-14T00:00:00.000Z', '2026-09-14T00:00:00.000Z')`).run();
  let serial = 0; const store = createRequirementStore(db, { idFactory: () => `link-${++serial}`, clock: () => '2026-09-14T00:00:00.000Z' });
  const bu = store.createBusinessUnit({ actorUserId: 'admin', actorRole: 'admin', name: '云 BU' });
  const requirement = store.createRequirement({ ownerUserId: 'owner', title: '关联需求', buId: bu.id, description: '' });
  db.prepare(`INSERT INTO conversations (id, owner_user_id, title, status, created_at, updated_at) VALUES
    ('conversation-owner', 'owner', '我的会话', 'active', '2026-09-14T00:00:00.000Z', '2026-09-14T00:00:00.000Z'),
    ('conversation-other', 'other', '他人会话', 'active', '2026-09-14T00:00:00.000Z', '2026-09-14T00:00:00.000Z')`).run();
  db.prepare(`INSERT INTO knowledge_documents (id, owner_user_id, status, visibility, current_version_id, created_at, updated_at) VALUES ('knowledge-owner', 'owner', 'draft', 'private', NULL, '2026-09-14T00:00:00.000Z', '2026-09-14T00:00:00.000Z')`).run();
  db.prepare(`INSERT INTO knowledge_versions (id, document_id, version_number, title, category, tags_json, markdown, is_current, created_at, created_by_user_id) VALUES ('knowledge-version-1', 'knowledge-owner', 1, '我的知识', '', '[]', '# v1', 1, '2026-09-14T00:00:00.000Z', 'owner')`).run();
  db.prepare("UPDATE knowledge_documents SET current_version_id = 'knowledge-version-1' WHERE id = 'knowledge-owner'").run();
  return { db, store, requirement };
}

test('links owned conversations and immutable current knowledge versions without copying bodies', () => {
  const { db, store, requirement } = fixture();
  const conversation = store.addRequirementLink({ ownerUserId: 'owner', requirementId: requirement.id, resourceType: 'conversation', resourceId: 'conversation-owner' });
  const knowledge = store.addRequirementLink({ ownerUserId: 'owner', requirementId: requirement.id, resourceType: 'knowledge', resourceId: 'knowledge-owner' });
  assert.deepEqual({ resourceType: conversation.resourceType, resourceId: conversation.resourceId, title: conversation.title }, { resourceType: 'conversation', resourceId: 'conversation-owner', title: '我的会话' });
  assert.equal(knowledge.versionId, 'knowledge-version-1');
  assert.equal(Object.hasOwn(knowledge, 'markdown'), false);
  assert.throws(() => store.addRequirementLink({ ownerUserId: 'owner', requirementId: requirement.id, resourceType: 'knowledge', resourceId: 'knowledge-owner' }), { code: 'REQUIREMENT_LINK_EXISTS' });
  assert.equal(store.getRequirement({ ownerUserId: 'owner', id: requirement.id }).links.length, 2);
  store.removeRequirementLink({ ownerUserId: 'owner', requirementId: requirement.id, linkId: conversation.id });
  assert.equal(store.getRequirement({ ownerUserId: 'owner', id: requirement.id }).links.length, 1);
  assert.equal(db.prepare("SELECT title FROM conversations WHERE id = 'conversation-owner'").get().title, '我的会话');
  db.close();
});

test('does not let a requirement relation disclose another member asset or access private requirements', () => {
  const { db, store, requirement } = fixture();
  assert.throws(() => store.addRequirementLink({ ownerUserId: 'owner', requirementId: requirement.id, resourceType: 'conversation', resourceId: 'conversation-other' }), { code: 'REQUIREMENT_LINK_TARGET_NOT_FOUND' });
  assert.throws(() => store.addRequirementLink({ ownerUserId: 'other', requirementId: requirement.id, resourceType: 'conversation', resourceId: 'conversation-owner' }), { code: 'REQUIREMENT_NOT_FOUND' });
  assert.throws(() => store.getRequirement({ ownerUserId: 'admin', id: requirement.id }), { code: 'REQUIREMENT_NOT_FOUND' });
  db.close();
});
