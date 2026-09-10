'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthenticatedWorkbench } = require('../fixtures/authenticated-workbench');

test('constructs one Stage 3 content store against the migrated workbench database', async (t) => {
  const fixture = await createAuthenticatedWorkbench(t);
  const member = await fixture.createMember({ username: 'content.member', displayName: 'Content Member' });
  assert.ok(fixture.workbench.contentStore);
  const draft = fixture.workbench.contentStore.createKnowledgeDraft({
    actorUserId: member.user.id,
    title: 'Foundation check',
    markdown: '# Foundation\nfts-is-ready'
  });
  assert.equal(
    fixture.workbench.contentStore.searchKnowledge({ actorUserId: member.user.id, query: 'fts-is-ready' })[0].id,
    draft.id
  );
});
