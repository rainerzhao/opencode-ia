'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { openDatabase } = require('../../src/db/open-database');
const { migrateDatabase } = require('../../src/db/migrate');
const { createGatewayStore } = require('../../src/gateway/gateway-store');
const { createContentStore } = require('../../src/content/content-store');

function fixture(t) {
  const db = openDatabase({ filename: ':memory:' });
  migrateDatabase(db);
  db.prepare(`INSERT INTO users (id, username, display_name, password_hash, role, status, created_at, updated_at)
    VALUES ('source-owner', 'source.owner', 'Source Owner', 'hash', 'member', 'active', ?, ?)`)
    .run('2026-09-11T00:00:00.000Z', '2026-09-11T00:00:00.000Z');
  t.after(() => db.close());
  const gateway = createGatewayStore(db, { idFactory: (() => { let n = 0; return () => `source-id-${++n}`; })() });
  const content = createContentStore(db, { idFactory: (() => { let n = 100; return () => `content-id-${++n}`; })(), clock: () => '2026-09-11T00:00:00.000Z' });
  return { gateway, content };
}

test('creates a private solution with conversation provenance details in the same transaction', (t) => {
  const { gateway, content } = fixture(t);
  const conversation = gateway.createConversation({ ownerUserId: 'source-owner', title: 'Source conversation' });
  const markdown = '完成的方案正文';
  const solution = content.createSolutionFromConversation({
    actorUserId: 'source-owner', actorRole: 'member', conversationId: conversation.id,
    title: '从对话沉淀的方案', description: '', assistantMarkdown: markdown,
    firstSequence: 1, lastSequence: 4, completedTurnCount: 1,
    contentSha256: crypto.createHash('sha256').update(markdown).digest('hex')
  });
  const detail = content.getSolution({ actorUserId: 'source-owner', actorRole: 'member', solutionId: solution.id, includeContent: true });
  assert.equal(detail.solutionMarkdown, markdown);
  assert.deepEqual(detail.references, [{
    sourceType: 'conversation', sourceId: conversation.id,
    firstSequence: 1, lastSequence: 4, completedTurnCount: 1,
    contentSha256: crypto.createHash('sha256').update(markdown).digest('hex')
  }]);
});

test('rejects provenance that is not owned by the solution actor or has a stale digest', (t) => {
  const { gateway, content } = fixture(t);
  const conversation = gateway.createConversation({ ownerUserId: 'source-owner', title: 'Source conversation' });
  assert.throws(() => content.createSolutionFromConversation({
    actorUserId: 'other-owner', actorRole: 'member', conversationId: conversation.id,
    title: '越权方案', assistantMarkdown: '正文', firstSequence: 1, lastSequence: 2,
    completedTurnCount: 1, contentSha256: '0'.repeat(64)
  }), (error) => error.code === 'CONTENT_NOT_FOUND');
  assert.throws(() => content.createSolutionFromConversation({
    actorUserId: 'source-owner', actorRole: 'member', conversationId: conversation.id,
    title: '摘要错误', assistantMarkdown: '正文', firstSequence: 1, lastSequence: 2,
    completedTurnCount: 1, contentSha256: '0'.repeat(64)
  }), (error) => error.code === 'INVALID_CONTENT_SOURCE');
});

test('creates a private knowledge draft from the current solution version atomically', (t) => {
  const { gateway, content } = fixture(t);
  const conversation = gateway.createConversation({ ownerUserId: 'source-owner', title: 'Source conversation' });
  const markdown = '方案正文';
  const solution = content.createSolutionFromConversation({
    actorUserId: 'source-owner', actorRole: 'member', conversationId: conversation.id,
    title: '方案', assistantMarkdown: markdown, firstSequence: 1, lastSequence: 2,
    completedTurnCount: 1, contentSha256: crypto.createHash('sha256').update(markdown).digest('hex')
  });
  const knowledge = content.createKnowledgeFromSolution({
    actorUserId: 'source-owner', actorRole: 'member', solutionId: solution.id,
    title: '知识草稿', markdown: '# 知识\n内容', tags: ['runtime']
  });
  const detail = content.getKnowledge({ actorUserId: 'source-owner', actorRole: 'member', documentId: knowledge.id, includeContent: true });
  assert.equal(detail.markdown, '# 知识\n内容');
  assert.deepEqual(detail.references, [{ sourceType: 'solution_version', sourceId: 'content-id-102', createdAt: '2026-09-11T00:00:00.000Z' }]);
});
