'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createAuditStore } = require('../../src/audit/audit-store');
const {
  authHeaders,
  createAuthenticatedWorkbench,
  readJson
} = require('../fixtures/authenticated-workbench');

test('rejects anonymous business REST access and requires CSRF for writes', async (t) => {
  const fixture = await createAuthenticatedWorkbench(t);

  const anonymous = await fetch(`${fixture.origin}/api/config`);
  assert.equal(anonymous.status, 401);
  assert.equal((await readJson(anonymous)).error.code, 'SESSION_INVALID');

  const authenticated = await fetch(`${fixture.origin}/api/config`, {
    headers: { cookie: fixture.admin.cookie }
  });
  assert.equal(authenticated.status, 200);
  assert.equal(authenticated.headers.get('cache-control'), 'no-store');
  assert.equal(Object.hasOwn(await readJson(authenticated), 'opencodeCwd'), false);

  const missingCsrf = await fetch(`${fixture.origin}/api/solutions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: fixture.admin.cookie
    },
    body: JSON.stringify({ title: 'blocked without csrf' })
  });
  assert.equal(missingCsrf.status, 403);
  assert.equal((await readJson(missingCsrf)).error.code, 'CSRF_INVALID');
});

test('enforces the admin and member role matrix for active sessions', async (t) => {
  const fixture = await createAuthenticatedWorkbench(t);
  const member = await fixture.createMember({ username: 'member.one', displayName: 'Member One' });

  const memberSessions = await fetch(`${fixture.origin}/api/sessions`, {
    headers: { cookie: member.cookie }
  });
  assert.equal(memberSessions.status, 403);
  assert.equal((await readJson(memberSessions)).error.code, 'FORBIDDEN');

  const adminSessions = await fetch(`${fixture.origin}/api/sessions`, {
    headers: { cookie: fixture.admin.cookie }
  });
  assert.equal(adminSessions.status, 200);
});

test('keeps solution records private between members while allowing admin management', async (t) => {
  const fixture = await createAuthenticatedWorkbench(t);
  const memberA = await fixture.createMember({ username: 'member.a', displayName: 'Member A' });
  const memberB = await fixture.createMember({ username: 'member.b', displayName: 'Member B' });

  const created = await fetch(`${fixture.origin}/api/solutions`, {
    method: 'POST',
    headers: authHeaders(memberA, { json: true }),
    body: JSON.stringify({ title: 'A private plan', description: 'member-a-only' })
  });
  assert.equal(created.status, 200);
  const solutionId = (await readJson(created)).id;
  assert.equal(fs.statSync(path.join(fixture.config.solutionsDir, `${solutionId}.json`)).mode & 0o777, 0o600);

  const listAResponse = await fetch(`${fixture.origin}/api/solutions`, {
    headers: { cookie: memberA.cookie }
  });
  assert.equal(listAResponse.headers.get('cache-control'), 'no-store');
  const listA = await readJson(listAResponse);
  const listB = await readJson(await fetch(`${fixture.origin}/api/solutions`, {
    headers: { cookie: memberB.cookie }
  }));
  const listAdmin = await readJson(await fetch(`${fixture.origin}/api/solutions`, {
    headers: { cookie: fixture.admin.cookie }
  }));

  assert.equal(listA.length, 1);
  assert.equal(listA[0].createdBy, memberA.user.id);
  assert.deepEqual(listB, []);
  assert.equal(listAdmin.length, 1);
});

test('isolates member knowledge writes and records safe actor-attributed audit metadata', async (t) => {
  const fixture = await createAuthenticatedWorkbench(t);
  const memberA = await fixture.createMember({ username: 'writer.a', displayName: 'Writer A' });
  const memberB = await fixture.createMember({ username: 'writer.b', displayName: 'Writer B' });
  const privateMarker = 'private-body-must-not-enter-audit';
  fs.mkdirSync(path.join(fixture.config.knowledgeDir, 'drafts'), { recursive: true });
  fs.writeFileSync(path.join(fixture.config.knowledgeDir, 'drafts', 'shared.md'), 'shared team knowledge');

  const saved = await fetch(`${fixture.origin}/api/knowledge/article`, {
    method: 'POST',
    headers: authHeaders(memberA, { json: true }),
    body: JSON.stringify({ filePath: 'drafts/plan.md', content: privateMarker })
  });
  assert.equal(saved.status, 200);

  const ownRead = await fetch(`${fixture.origin}/api/knowledge/article?path=drafts%2Fplan.md`, {
    headers: { cookie: memberA.cookie }
  });
  assert.equal(ownRead.status, 200);
  assert.equal((await readJson(ownRead)).content, privateMarker);

  const otherRead = await fetch(`${fixture.origin}/api/knowledge/article?path=drafts%2Fplan.md`, {
    headers: { cookie: memberB.cookie }
  });
  assert.equal(otherRead.status, 404);

  const tree = await readJson(await fetch(`${fixture.origin}/api/knowledge/tree`, {
    headers: { cookie: memberA.cookie }
  }));
  const drafts = tree.find((item) => item.path === 'drafts');
  assert.deepEqual(
    drafts.children.map((item) => item.path).sort(),
    ['drafts/plan.md', 'drafts/shared.md']
  );

  const audit = createAuditStore(fixture.db).list({ limit: 100 });
  const event = audit.find((item) => item.action === 'knowledge.article.save');
  assert.equal(event.actorUserId, memberA.user.id);
  assert.equal(event.targetType, 'knowledge_article');
  assert.equal(event.targetId, 'drafts/plan.md');
  assert.equal(typeof event.metadata.requestId, 'string');
  assert.equal(JSON.stringify(event).includes(privateMarker), false);

  const privateRoot = path.join(fixture.config.knowledgeDir, '.private', memberA.user.id);
  assert.equal(fs.readFileSync(path.join(privateRoot, 'drafts', 'plan.md'), 'utf8'), privateMarker);
  assert.equal(fs.statSync(privateRoot).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(privateRoot, 'drafts', 'plan.md')).mode & 0o777, 0o600);
});
