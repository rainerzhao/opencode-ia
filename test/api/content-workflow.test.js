'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuditStore } = require('../../src/audit/audit-store');
const { authHeaders, createAuthenticatedWorkbench, readJson } = require('../fixtures/authenticated-workbench');

test('creates private content, publishes it explicitly, then withdraws it with safe audit metadata', async (t) => {
  const fixture = await createAuthenticatedWorkbench(t);
  const author = await fixture.createMember({ username: 'content.author', displayName: 'Content Author' });
  const viewer = await fixture.createMember({ username: 'content.viewer', displayName: 'Content Viewer' });
  const secretBody = 'private-content-must-not-enter-audit';
  const created = await fetch(`${fixture.origin}/api/content/knowledge`, {
    method: 'POST', headers: authHeaders(author, { json: true }),
    body: JSON.stringify({ title: 'GPU proposal', category: 'gpu', tags: ['H800'], markdown: `# GPU\n${secretBody}` })
  });
  assert.equal(created.status, 201);
  const knowledge = (await readJson(created)).knowledge;
  assert.equal(knowledge.visibility, 'private');

  const privateRead = await fetch(`${fixture.origin}/api/content/knowledge/${knowledge.id}`, { headers: { cookie: viewer.cookie } });
  assert.equal(privateRead.status, 404);
  const noCsrf = await fetch(`${fixture.origin}/api/content/knowledge/${knowledge.id}/publish`, {
    method: 'POST', headers: { cookie: author.cookie }
  });
  assert.equal(noCsrf.status, 403);

  const published = await fetch(`${fixture.origin}/api/content/knowledge/${knowledge.id}/publish`, {
    method: 'POST', headers: authHeaders(author)
  });
  assert.equal(published.status, 200);
  assert.deepEqual([(await readJson(published)).knowledge.status, (await fetch(`${fixture.origin}/api/content/knowledge/${knowledge.id}`, { headers: { cookie: viewer.cookie } })).status], ['published', 200]);

  const withdrawn = await fetch(`${fixture.origin}/api/content/knowledge/${knowledge.id}/withdraw`, {
    method: 'POST', headers: authHeaders(author)
  });
  assert.equal(withdrawn.status, 200);
  const absentAgain = await fetch(`${fixture.origin}/api/content/knowledge/${knowledge.id}`, { headers: { cookie: viewer.cookie } });
  assert.equal(absentAgain.status, 404);
  const audit = createAuditStore(fixture.db).list({ limit: 100 });
  assert.deepEqual(audit.filter((item) => item.targetId === knowledge.id).map((item) => item.action).reverse(), [
    'content.knowledge.create', 'content.knowledge.publish', 'content.knowledge.withdraw'
  ]);
  assert.equal(JSON.stringify(audit).includes(secretBody), false);
});

test('keeps solution bodies private by default and permits owner-only updates', async (t) => {
  const fixture = await createAuthenticatedWorkbench(t);
  const author = await fixture.createMember({ username: 'solution.author', displayName: 'Solution Author' });
  const viewer = await fixture.createMember({ username: 'solution.viewer', displayName: 'Solution Viewer' });
  const created = await fetch(`${fixture.origin}/api/content/solutions`, {
    method: 'POST', headers: authHeaders(author, { json: true }),
    body: JSON.stringify({ title: 'Cluster solution', description: 'private', solutionMarkdown: '# Cluster\nprivate' })
  });
  assert.equal(created.status, 201);
  const solution = (await readJson(created)).solution;
  const blocked = await fetch(`${fixture.origin}/api/content/solutions/${solution.id}`, { headers: { cookie: viewer.cookie } });
  assert.equal(blocked.status, 404);
  const updated = await fetch(`${fixture.origin}/api/content/solutions/${solution.id}`, {
    method: 'PATCH', headers: authHeaders(author, { json: true }), body: JSON.stringify({ solutionMarkdown: '# Cluster\nrevised' })
  });
  assert.equal(updated.status, 200);
  assert.equal((await readJson(updated)).solution.version, 2);
});
