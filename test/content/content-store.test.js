'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../../src/db/open-database');
const { migrateDatabase } = require('../../src/db/migrate');
const { createContentStore } = require('../../src/content/content-store');

function fixture(t) {
  const db = openDatabase({ filename: ':memory:' });
  migrateDatabase(db);
  t.after(() => db.close());
  const now = '2026-09-10T00:00:00.000Z';
  for (const [id, username, role] of [
    ['member-a', 'member.a', 'member'], ['member-b', 'member.b', 'member'], ['admin', 'admin', 'admin']
  ]) {
    db.prepare(`
      INSERT INTO users (id, username, display_name, password_hash, role, status, created_at, updated_at)
      VALUES (?, ?, ?, 'not-a-password', ?, 'active', ?, ?)
    `).run(id, username, username, role, now, now);
  }
  let nextId = 0;
  const store = createContentStore(db, {
    clock: () => now,
    idFactory: () => `id-${++nextId}`
  });
  return { db, store };
}

test('keeps private knowledge out of another member search and indexes only the current version', (t) => {
  const { store } = fixture(t);
  const draft = store.createKnowledgeDraft({
    actorUserId: 'member-a', title: 'GPU plan', category: 'gpu', tags: ['H800'], markdown: '# GPU plan\nH800 80GB'
  });
  assert.equal(draft.version, 1);
  assert.deepEqual(store.searchKnowledge({ actorUserId: 'member-b', query: 'H800' }), []);
  assert.equal(store.searchKnowledge({ actorUserId: 'member-a', query: 'H800' })[0].id, draft.id);

  const revised = store.saveKnowledgeVersion({
    actorUserId: 'member-a', documentId: draft.id, tags: [], markdown: '# GPU plan\nL40S now replaces the prior hardware'
  });
  assert.equal(revised.version, 2);
  assert.deepEqual(store.searchKnowledge({ actorUserId: 'member-a', query: 'H800' }), []);
  assert.equal(store.searchKnowledge({ actorUserId: 'member-a', query: 'L40S' })[0].version, 2);
  const detail = store.getKnowledge({ actorUserId: 'member-a', documentId: draft.id, includeContent: true });
  assert.equal(detail.markdown, '# GPU plan\nL40S now replaces the prior hardware');
  assert.equal(detail.versionHistory.length, 2);
  assert.equal(detail.versionHistory[1].markdown, undefined);
});

test('returns published team knowledge to members without exposing private document existence', (t) => {
  const { store } = fixture(t);
  const privateDraft = store.createKnowledgeDraft({
    actorUserId: 'member-a', title: 'Secret roadmap', markdown: '# Secret roadmap\nprivate-token-like-note'
  });
  assert.throws(
    () => store.getKnowledge({ actorUserId: 'member-b', documentId: privateDraft.id }),
    (error) => error.code === 'CONTENT_NOT_FOUND'
  );
  const unPublishedTeamDraft = store.createKnowledgeDraft({
    actorUserId: 'member-a', title: 'Unpublished team draft', markdown: '# Unpublished\nnot-for-members', visibility: 'team', status: 'draft'
  });
  assert.deepEqual(store.searchKnowledge({ actorUserId: 'member-b', query: 'not-for-members' }), []);
  assert.throws(
    () => store.getKnowledge({ actorUserId: 'member-b', documentId: unPublishedTeamDraft.id }),
    (error) => error.code === 'CONTENT_NOT_FOUND'
  );
  const teamDraft = store.createKnowledgeDraft({
    actorUserId: 'member-a', title: 'Shared H800 baseline', markdown: '# Shared\nH800 baseline', visibility: 'team', status: 'published'
  });
  const result = store.searchKnowledge({ actorUserId: 'member-b', query: 'H800' });
  assert.deepEqual(result.map((item) => item.id), [teamDraft.id]);
  assert.equal(store.getKnowledge({ actorUserId: 'member-b', documentId: teamDraft.id, includeContent: true }).markdown, '# Shared\nH800 baseline');
});

test('creates immutable solution versions and preserves source identifiers without copying content into list summaries', (t) => {
  const { store } = fixture(t);
  const solution = store.createSolutionDraft({
    actorUserId: 'member-a', title: 'Cluster proposal', description: 'customer private constraint', solutionMarkdown: '# Cluster\nInitial plan',
    references: [{ sourceType: 'conversation', sourceId: 'conversation-1' }, { sourceType: 'model', sourceId: 'internal/model-a' }]
  });
  const revised = store.saveSolutionVersion({
    actorUserId: 'member-a', solutionId: solution.id, solutionMarkdown: '# Cluster\nRevised plan'
  });
  assert.equal(revised.version, 2);
  const listed = store.listSolutions({ actorUserId: 'member-a' });
  assert.deepEqual(listed.map((item) => Object.keys(item).sort()), [[
    'createdAt', 'id', 'ownerUserId', 'status', 'title', 'updatedAt', 'version', 'visibility'
  ]]);
  const detail = store.getSolution({ actorUserId: 'member-a', solutionId: solution.id, includeContent: true });
  assert.equal(detail.solutionMarkdown, '# Cluster\nRevised plan');
  assert.deepEqual(detail.references.map((item) => [item.sourceType, item.sourceId]), [
    ['conversation', 'conversation-1'], ['model', 'internal/model-a']
  ]);
  assert.equal(detail.versionHistory.length, 2);
});

test('publishes and withdraws content through immutable visibility transition versions', (t) => {
  const { store } = fixture(t);
  const knowledge = store.createKnowledgeDraft({
    actorUserId: 'member-a', title: 'Private GPU review', markdown: '# GPU\nprivate draft'
  });
  const publishedKnowledge = store.publishKnowledge({ actorUserId: 'member-a', documentId: knowledge.id });
  assert.deepEqual(
    [publishedKnowledge.version, publishedKnowledge.status, publishedKnowledge.visibility], [2, 'published', 'team']
  );
  assert.equal(store.getKnowledge({ actorUserId: 'member-b', documentId: knowledge.id, includeContent: true }).markdown, '# GPU\nprivate draft');
  const withdrawnKnowledge = store.withdrawKnowledge({ actorUserId: 'member-a', documentId: knowledge.id });
  assert.deepEqual(
    [withdrawnKnowledge.version, withdrawnKnowledge.status, withdrawnKnowledge.visibility], [3, 'withdrawn', 'private']
  );
  assert.throws(
    () => store.getKnowledge({ actorUserId: 'member-b', documentId: knowledge.id }),
    (error) => error.code === 'CONTENT_NOT_FOUND'
  );

  const solution = store.createSolutionDraft({
    actorUserId: 'member-a', title: 'Private cluster solution', solutionMarkdown: '# Cluster\nprivate'
  });
  assert.equal(store.publishSolution({ actorUserId: 'member-a', solutionId: solution.id }).version, 2);
  assert.equal(store.withdrawSolution({ actorUserId: 'member-a', solutionId: solution.id }).status, 'withdrawn');
});

test('lists an owner draft and a separately published team knowledge document without markdown', (t) => {
  const { store } = fixture(t);
  const own = store.createKnowledgeDraft({ actorUserId: 'member-a', title: 'Own draft', markdown: '# Own\nprivate' });
  const team = store.createKnowledgeDraft({
    actorUserId: 'member-b', title: 'Team baseline', markdown: '# Team\nshared', visibility: 'team', status: 'published'
  });
  const rows = store.listKnowledge({ actorUserId: 'member-a' });
  assert.deepEqual(rows.map((item) => item.id), [team.id, own.id]);
  assert.equal('markdown' in rows[0], false);
});
