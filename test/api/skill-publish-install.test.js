'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuditStore } = require('../../src/audit/audit-store');
const { authHeaders, createAuthenticatedWorkbench, readJson } = require('../fixtures/authenticated-workbench');

async function request(origin, session, pathname, options = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    ...options,
    headers: { ...authHeaders(session, { json: options.body !== undefined }), ...(options.headers || {}) }
  });
  return { response, body: await readJson(response) };
}

function draftBody() {
  return {
    slug: 'team-published',
    displayName: 'Team Published',
    description: 'A published team Skill',
    skillMd: '---\nname: team-published\ndescription: Team published Skill\n---\n\n# Instructions\n'
  };
}

test('owner publishes a validated Skill and another member independently installs then enables it', async (t) => {
  const fixture = await createAuthenticatedWorkbench(t, {
    skillRuntimeValidator: { async validate() { return { status: 'passed', durationMs: 1 }; } }
  });
  const owner = await fixture.createMember({ username: 'publish.owner' });
  const member = await fixture.createMember({ username: 'publish.member' });
  const created = await request(fixture.origin, owner, '/api/skills', {
    method: 'POST', body: JSON.stringify(draftBody())
  });
  const id = created.body.skill.id;
  const validated = await request(fixture.origin, owner, `/api/skills/${id}/validate`, { method: 'POST' });
  assert.equal(validated.response.status, 200);
  assert.equal(validated.body.skill.version.status, 'validated');

  const published = await request(fixture.origin, owner, `/api/skills/${id}/publish`, { method: 'POST' });
  assert.equal(published.response.status, 200);
  assert.equal(published.body.skill.status, 'published');
  assert.equal(published.body.skill.visibility, 'team');
  assert.equal((await request(fixture.origin, member, '/api/skills?status=published')).body.skills[0].id, id);

  const installed = await request(fixture.origin, member, `/api/skills/${id}/install`, { method: 'POST' });
  assert.equal(installed.response.status, 200);
  assert.equal(installed.body.installation.status, 'installed');
  assert.equal((await request(fixture.origin, owner, '/api/skills/installations')).body.installations.length, 0);

  const enabled = await request(fixture.origin, member, `/api/skills/${id}/enable`, { method: 'POST' });
  assert.equal(enabled.response.status, 200);
  assert.equal(enabled.body.installation.status, 'enabled');
  assert.equal((await request(fixture.origin, member, '/api/skills/installations')).body.installations[0].status, 'enabled');

  const audit = createAuditStore(fixture.db).list({ limit: 100 }).filter((event) => event.targetId === id);
  assert.deepEqual(audit.map((event) => event.action).filter((action) => action.startsWith('skill.')).sort(), [
    'skill.create', 'skill.enable', 'skill.install', 'skill.publish', 'skill.validate'
  ]);
  assert.equal(JSON.stringify(audit).includes('# Instructions'), false);
});

test('rejects publishing an unvalidated Skill and cross-account publish attempts', async (t) => {
  const fixture = await createAuthenticatedWorkbench(t, {
    skillRuntimeValidator: { async validate() { return { status: 'passed' }; } }
  });
  const owner = await fixture.createMember({ username: 'publish.private.owner' });
  const sibling = await fixture.createMember({ username: 'publish.private.sibling' });
  const created = await request(fixture.origin, owner, '/api/skills', {
    method: 'POST', body: JSON.stringify({ ...draftBody(), slug: 'still-private' })
  });
  const id = created.body.skill.id;
  const unpublished = await request(fixture.origin, owner, `/api/skills/${id}/publish`, { method: 'POST' });
  assert.equal(unpublished.response.status, 409);
  assert.equal(unpublished.body.error.code, 'SKILL_NOT_PUBLISHABLE');
  const stolen = await request(fixture.origin, sibling, `/api/skills/${id}/publish`, { method: 'POST' });
  assert.equal(stolen.response.status, 404);
});
