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

function draftBody(overrides = {}) {
  return {
    slug: 'gpu-planner',
    displayName: 'GPU 规划助手',
    description: '估算模型与 GPU 容量',
    skillMd: '---\nname: gpu-planner\ndescription: Plan GPU capacity\n---\n\n# Instructions\nPRIVATE_SKILL_BODY',
    ...overrides
  };
}

test('member creates, lists, reads, updates and archives a private Skill draft', async (t) => {
  const fixture = await createAuthenticatedWorkbench(t);
  const member = await fixture.createMember({ username: 'skill.owner' });

  const created = await jsonRequest(fixture.origin, member, '/api/skills', {
    method: 'POST', body: JSON.stringify(draftBody())
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.skill.slug, 'gpu-planner');
  assert.equal(created.body.skill.visibility, 'private');
  assert.equal(created.body.skill.version.version, '0.1.0');

  const list = await jsonRequest(fixture.origin, member, '/api/skills');
  assert.deepEqual(list.body.skills.map((item) => item.id), [created.body.skill.id]);
  assert.equal(JSON.stringify(list.body).includes('PRIVATE_SKILL_BODY'), false);

  const detail = await jsonRequest(fixture.origin, member, `/api/skills/${created.body.skill.id}`);
  assert.match(detail.body.skill.version.skillMd, /PRIVATE_SKILL_BODY/);

  const updated = await jsonRequest(fixture.origin, member, `/api/skills/${created.body.skill.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ displayName: 'GPU 规划 Skill', skillMd: '# Updated instructions' })
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.skill.displayName, 'GPU 规划 Skill');
  assert.equal(updated.body.skill.version.skillMd, '# Updated instructions');

  const archived = await jsonRequest(fixture.origin, member, `/api/skills/${created.body.skill.id}`, {
    method: 'DELETE'
  });
  assert.equal(archived.response.status, 204);
  assert.deepEqual((await jsonRequest(fixture.origin, member, '/api/skills')).body.skills, []);
  const archivedList = await jsonRequest(fixture.origin, member, '/api/skills?status=archived');
  assert.equal(archivedList.body.skills[0].status, 'archived');
});

test('keeps drafts private, gives administrators governance access and protects writes with CSRF', async (t) => {
  const fixture = await createAuthenticatedWorkbench(t);
  const owner = await fixture.createMember({ username: 'skill.private.owner' });
  const sibling = await fixture.createMember({ username: 'skill.sibling' });
  const created = await jsonRequest(fixture.origin, owner, '/api/skills', {
    method: 'POST', body: JSON.stringify(draftBody({ slug: 'private-skill' }))
  });
  const id = created.body.skill.id;

  assert.equal((await jsonRequest(fixture.origin, sibling, `/api/skills/${id}`)).response.status, 404);
  assert.equal((await jsonRequest(fixture.origin, sibling, `/api/skills/${id}`, {
    method: 'PATCH', body: JSON.stringify({ displayName: 'Stolen' })
  })).response.status, 404);
  assert.deepEqual((await jsonRequest(fixture.origin, sibling, '/api/skills')).body.skills, []);

  const adminList = await jsonRequest(fixture.origin, fixture.admin, '/api/skills');
  assert.equal(adminList.body.skills[0].id, id);
  const adminDetail = await jsonRequest(fixture.origin, fixture.admin, `/api/skills/${id}`);
  assert.match(adminDetail.body.skill.version.skillMd, /PRIVATE_SKILL_BODY/);

  const noCsrf = await fetch(`${fixture.origin}/api/skills`, {
    method: 'POST',
    headers: { cookie: owner.cookie, 'content-type': 'application/json' },
    body: JSON.stringify(draftBody({ slug: 'no-csrf' }))
  });
  assert.equal(noCsrf.status, 403);
});

test('returns stable validation and conflict errors without writing private source to audit', async (t) => {
  const fixture = await createAuthenticatedWorkbench(t);
  const member = await fixture.createMember({ username: 'skill.audit.owner' });
  const created = await jsonRequest(fixture.origin, member, '/api/skills', {
    method: 'POST', body: JSON.stringify(draftBody({ slug: 'audited-skill' }))
  });
  const id = created.body.skill.id;

  const duplicate = await jsonRequest(fixture.origin, member, '/api/skills', {
    method: 'POST', body: JSON.stringify(draftBody({ slug: 'AUDITED-SKILL' }))
  });
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.body.error.code, 'SKILL_SLUG_CONFLICT');

  const invalid = await jsonRequest(fixture.origin, member, '/api/skills', {
    method: 'POST', body: JSON.stringify(draftBody({ slug: '../escape' }))
  });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.error.code, 'INVALID_SKILL_SLUG');

  const immutableSlug = await jsonRequest(fixture.origin, member, `/api/skills/${id}`, {
    method: 'PATCH', body: JSON.stringify({ slug: 'renamed-skill' })
  });
  assert.equal(immutableSlug.response.status, 400);
  assert.equal(immutableSlug.body.error.code, 'SKILL_SLUG_IMMUTABLE');

  await jsonRequest(fixture.origin, member, `/api/skills/${id}`, {
    method: 'PATCH', body: JSON.stringify({ description: 'New description' })
  });
  await jsonRequest(fixture.origin, member, `/api/skills/${id}`, { method: 'DELETE' });
  const events = createAuditStore(fixture.db).list({ limit: 100 })
    .filter((item) => item.targetId === id);
  assert.deepEqual(events.map((item) => item.action).sort(), [
    'skill.archive', 'skill.create', 'skill.update'
  ]);
  assert.equal(JSON.stringify(events).includes('PRIVATE_SKILL_BODY'), false);
});
