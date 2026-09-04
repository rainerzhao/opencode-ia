'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuditStore } = require('../../src/audit/audit-store');
const {
  authHeaders,
  createAuthenticatedWorkbench,
  readJson
} = require('../fixtures/authenticated-workbench');

async function jsonRequest(origin, session, pathname, options = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    ...options,
    headers: {
      ...authHeaders(session, { json: options.body !== undefined }),
      ...(options.headers || {})
    }
  });
  return { response, body: await readJson(response) };
}

test('creates, lists, reads, renames, and archives a private conversation', async (t) => {
  const fixture = await createAuthenticatedWorkbench(t);
  const member = await fixture.createMember({ username: 'conversation.owner' });

  const created = await jsonRequest(fixture.origin, member, '/api/conversations', {
    method: 'POST',
    body: JSON.stringify({ title: ' GPU 采购讨论 ' })
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.conversation.title, 'GPU 采购讨论');
  assert.equal(created.body.conversation.ownerUserId, member.user.id);

  const list = await jsonRequest(fixture.origin, member, '/api/conversations');
  assert.deepEqual(list.body.conversations.map((item) => item.id), [created.body.conversation.id]);

  const read = await jsonRequest(
    fixture.origin,
    member,
    `/api/conversations/${created.body.conversation.id}`
  );
  assert.equal(read.body.conversation.id, created.body.conversation.id);

  const renamed = await jsonRequest(
    fixture.origin,
    member,
    `/api/conversations/${created.body.conversation.id}`,
    { method: 'PATCH', body: JSON.stringify({ title: 'GPU 最终建议' }) }
  );
  assert.equal(renamed.body.conversation.title, 'GPU 最终建议');

  const archived = await jsonRequest(
    fixture.origin,
    member,
    `/api/conversations/${created.body.conversation.id}`,
    { method: 'DELETE' }
  );
  assert.equal(archived.response.status, 204);
  assert.deepEqual((await jsonRequest(fixture.origin, member, '/api/conversations')).body.conversations, []);
  const archivedList = await jsonRequest(fixture.origin, member, '/api/conversations?status=archived');
  assert.equal(archivedList.body.conversations[0].status, 'archived');
});

test('enforces ownership, CSRF, safe identifiers, and active-conversation writes', async (t) => {
  const fixture = await createAuthenticatedWorkbench(t);
  const owner = await fixture.createMember({ username: 'owner.user' });
  const sibling = await fixture.createMember({ username: 'sibling.user' });
  const created = await jsonRequest(fixture.origin, owner, '/api/conversations', {
    method: 'POST',
    body: JSON.stringify({ title: 'Owner only' })
  });
  const id = created.body.conversation.id;

  const siblingRead = await jsonRequest(fixture.origin, sibling, `/api/conversations/${id}`);
  assert.equal(siblingRead.response.status, 404);
  const siblingPatch = await jsonRequest(fixture.origin, sibling, `/api/conversations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: 'stolen' })
  });
  assert.equal(siblingPatch.response.status, 404);

  const noCsrf = await fetch(`${fixture.origin}/api/conversations`, {
    method: 'POST',
    headers: { cookie: owner.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'No CSRF' })
  });
  assert.equal(noCsrf.status, 403);

  const invalid = await jsonRequest(fixture.origin, owner, '/api/conversations/%00');
  assert.equal(invalid.response.status, 400);

  await jsonRequest(fixture.origin, owner, `/api/conversations/${id}`, { method: 'DELETE' });
  const archivedPatch = await jsonRequest(fixture.origin, owner, `/api/conversations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: 'must not change' })
  });
  assert.equal(archivedPatch.response.status, 409);
});

test('gives administrators operational metadata without private titles or bodies', async (t) => {
  const fixture = await createAuthenticatedWorkbench(t);
  const member = await fixture.createMember({ username: 'private.member' });
  const created = await jsonRequest(fixture.origin, member, '/api/conversations', {
    method: 'POST',
    body: JSON.stringify({ title: 'Confidential acquisition plan' })
  });

  const adminView = await jsonRequest(fixture.origin, fixture.admin, '/api/admin/conversations');
  assert.equal(adminView.response.status, 200);
  const metadata = adminView.body.conversations.find((item) => item.id === created.body.conversation.id);
  assert.deepEqual(Object.keys(metadata).sort(), [
    'createdAt', 'id', 'ownerUserId', 'status', 'updatedAt'
  ]);
  assert.equal(JSON.stringify(adminView.body).includes('Confidential acquisition plan'), false);

  const memberView = await jsonRequest(fixture.origin, member, '/api/admin/conversations');
  assert.equal(memberView.response.status, 403);
});

test('records actor-attributed conversation mutations without private titles', async (t) => {
  const fixture = await createAuthenticatedWorkbench(t);
  const member = await fixture.createMember({ username: 'audited.member' });
  const created = await jsonRequest(fixture.origin, member, '/api/conversations', {
    method: 'POST',
    body: JSON.stringify({ title: 'Private title must not enter audit' })
  });
  await jsonRequest(fixture.origin, member, `/api/conversations/${created.body.conversation.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: 'Renamed private title' })
  });

  const events = createAuditStore(fixture.db).list({ limit: 100 })
    .filter((item) => item.targetId === created.body.conversation.id);
  assert.deepEqual(events.map((item) => item.action).sort(), [
    'conversation.create', 'conversation.rename'
  ]);
  assert.equal(events.every((item) => item.actorUserId === member.user.id), true);
  assert.equal(JSON.stringify(events).includes('private title'), false);
});
