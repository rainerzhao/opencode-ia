'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMySqlDatabase } = require('../../src/db/mysql-database');
const { migrateMySqlDatabase } = require('../../src/db/mysql-migrate');
const { createMySqlContentStore } = require('../../src/content/mysql-content-store');

const testUrl = process.env.WORKBENCH_TEST_MYSQL_URL;

async function cleanFixture(db) {
  const ids = ['mysql-content-user-a', 'mysql-content-user-b'];
  await db.query(`DELETE r FROM content_references r
    JOIN solution_versions v ON v.id = r.solution_version_id
    JOIN solutions s ON s.id = v.solution_id
    WHERE s.owner_user_id IN (?, ?)`, ids);
  await db.query('UPDATE knowledge_documents SET current_version_id = NULL WHERE owner_user_id IN (?, ?)', ids);
  await db.query('DELETE FROM knowledge_versions WHERE document_id IN (SELECT id FROM knowledge_documents WHERE owner_user_id IN (?, ?))', ids);
  await db.query('DELETE FROM knowledge_documents WHERE owner_user_id IN (?, ?)', ids);
  await db.query('UPDATE solutions SET current_version_id = NULL WHERE owner_user_id IN (?, ?)', ids);
  await db.query('DELETE FROM solution_versions WHERE solution_id IN (SELECT id FROM solutions WHERE owner_user_id IN (?, ?))', ids);
  await db.query('DELETE FROM solutions WHERE owner_user_id IN (?, ?)', ids);
  await db.query('DELETE FROM users WHERE id IN (?, ?)', ids);
}

test('persists private versioned knowledge and solutions on MySQL', { skip: !testUrl }, async (t) => {
  const db = await createMySqlDatabase({ url: testUrl, poolSize: 2 });
  t.after(async () => db.close());
  await migrateMySqlDatabase(db);
  await cleanFixture(db);
  await db.query(`INSERT INTO users (id, username, display_name, password_hash, role, status, created_at, updated_at)
    VALUES
      ('mysql-content-user-a', 'mysql.content.a', 'MySQL Content A', 'hash', 'member', 'active', '2026-09-11 00:00:00.000', '2026-09-11 00:00:00.000'),
      ('mysql-content-user-b', 'mysql.content.b', 'MySQL Content B', 'hash', 'member', 'active', '2026-09-11 00:00:00.000', '2026-09-11 00:00:00.000')`);
  let nextId = 0;
  const store = createMySqlContentStore(db, {
    idFactory: () => `mysql-content-${++nextId}`,
    clock: () => '2026-09-11T00:00:00.000Z'
  });
  const owner = { actorUserId: 'mysql-content-user-a', actorRole: 'member' };
  const other = { actorUserId: 'mysql-content-user-b', actorRole: 'member' };

  const knowledge = await store.createKnowledgeDraft({
    ...owner, title: 'Private MySQL Gateway Guide', category: 'runtime', tags: ['mysql', 'gateway'], markdown: '# private gateway guide'
  });
  await assert.rejects(() => store.getKnowledge({ ...other, documentId: knowledge.id }), (error) => error?.code === 'CONTENT_NOT_FOUND');
  assert.deepEqual(await store.searchKnowledge({ ...other, query: 'Gateway' }), []);
  const editedKnowledge = await store.saveKnowledgeVersion({ ...owner, documentId: knowledge.id, title: 'Published MySQL Gateway Guide' });
  assert.equal(editedKnowledge.version, 2);
  const publishedKnowledge = await store.publishKnowledge({ ...owner, documentId: knowledge.id });
  assert.equal(publishedKnowledge.visibility, 'team');
  assert.equal((await store.getKnowledge({ ...other, documentId: knowledge.id, includeContent: true })).markdown, '# private gateway guide');
  assert.equal((await store.searchKnowledge({ ...other, query: 'Gateway' }))[0].id, knowledge.id);
  const withdrawnKnowledge = await store.withdrawKnowledge({ ...owner, documentId: knowledge.id });
  assert.equal(withdrawnKnowledge.version, 4);
  await assert.rejects(() => store.getKnowledge({ ...other, documentId: knowledge.id }), (error) => error?.code === 'CONTENT_NOT_FOUND');
  assert.equal((await store.getKnowledge({ ...owner, documentId: knowledge.id })).versionHistory.length, 4);
  await store.createKnowledgeAttachment({
    ...owner, documentId: knowledge.id, id: 'mysql-content-attachment', originalName: 'guide.md',
    mediaType: 'text/markdown', sizeBytes: 4, contentSha256: 'a'.repeat(64), storageKey: 'mysql-content/shared/guide.md'
  });
  await store.saveKnowledgeVersion({ ...owner, documentId: knowledge.id, markdown: '# changed after attachment' });
  assert.equal((await store.getKnowledge({ ...owner, documentId: knowledge.id })).attachments.length, 1);
  const restoredKnowledge = await store.restoreKnowledgeVersion({ ...owner, documentId: knowledge.id, version: 4 });
  assert.equal(restoredKnowledge.version, 6);
  assert.equal((await store.getKnowledge({ ...owner, documentId: knowledge.id })).attachments.length, 1);

  const solution = await store.createSolutionDraft({
    ...owner, title: 'Private migration solution', description: 'private', solutionMarkdown: '# solution',
    references: [{ sourceType: 'conversation', sourceId: 'conversation-source-1' }]
  });
  await assert.rejects(() => store.getSolution({ ...other, solutionId: solution.id }), (error) => error?.code === 'CONTENT_NOT_FOUND');
  const publishedSolution = await store.publishSolution({ ...owner, solutionId: solution.id });
  assert.equal(publishedSolution.visibility, 'team');
  const visibleSolution = await store.getSolution({ ...other, solutionId: solution.id, includeContent: true });
  assert.deepEqual(visibleSolution.references, [{ sourceType: 'conversation', sourceId: 'conversation-source-1' }]);
  assert.equal(visibleSolution.solutionMarkdown, '# solution');
  const withdrawnSolution = await store.withdrawSolution({ ...owner, solutionId: solution.id });
  assert.equal(withdrawnSolution.version, 3);
  await assert.rejects(() => store.getSolution({ ...other, solutionId: solution.id }), (error) => error?.code === 'CONTENT_NOT_FOUND');
  const restoredSolution = await store.restoreSolutionVersion({ ...owner, solutionId: solution.id, version: 1 });
  assert.equal(restoredSolution.version, 4);
  assert.deepEqual((await store.getSolution({ ...owner, solutionId: solution.id })).references, [{ sourceType: 'conversation', sourceId: 'conversation-source-1' }]);
});
