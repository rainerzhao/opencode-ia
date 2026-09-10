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
    slug: 'governed-team-skill', displayName: 'Governed Team Skill',
    skillMd: '---\nname: governed-team-skill\ndescription: Governed team Skill\n---\n\n# Release 0.1.0\n'
  };
}

test('keeps successor drafts private, supports member upgrade/rollback, then revokes on disable/archive', async (t) => {
  const fixture = await createAuthenticatedWorkbench(t, {
    skillRuntimeValidator: { async validate() { return { status: 'passed', durationMs: 1 }; } }
  });
  const owner = await fixture.createMember({ username: 'governance.owner' });
  const member = await fixture.createMember({ username: 'governance.member' });
  const created = await request(fixture.origin, owner, '/api/skills', {
    method: 'POST', body: JSON.stringify(draftBody())
  });
  const id = created.body.skill.id;
  await request(fixture.origin, owner, `/api/skills/${id}/validate`, { method: 'POST' });
  const first = await request(fixture.origin, owner, `/api/skills/${id}/publish`, { method: 'POST' });
  await request(fixture.origin, member, `/api/skills/${id}/install`, { method: 'POST' });
  await request(fixture.origin, member, `/api/skills/${id}/enable`, { method: 'POST' });

  const successor = await request(fixture.origin, owner, `/api/skills/${id}/versions`, { method: 'POST' });
  assert.equal(successor.response.status, 201);
  assert.equal(successor.body.skill.version.version, '0.2.0');
  const memberView = await request(fixture.origin, member, `/api/skills/${id}`);
  assert.equal(memberView.body.skill.version.version, '0.1.0');
  const edited = await request(fixture.origin, owner, `/api/skills/${id}`, {
    method: 'PATCH', body: JSON.stringify({
      skillMd: '---\nname: governed-team-skill\ndescription: Governed team Skill\n---\n\n# Release 0.2.0\n'
    })
  });
  const revalidated = await request(fixture.origin, owner, `/api/skills/${id}/validate`, { method: 'POST' });
  assert.equal(revalidated.response.status, 200);
  const second = await request(fixture.origin, owner, `/api/skills/${id}/publish`, { method: 'POST' });
  assert.equal(second.body.skill.version.version, '0.2.0');
  assert.notEqual(edited.body.skill.version.contentSha256, first.body.skill.version.contentSha256);

  const upgraded = await request(fixture.origin, member, `/api/skills/${id}/upgrade`, {
    method: 'POST', body: JSON.stringify({ versionId: second.body.skill.version.id })
  });
  assert.equal(upgraded.response.status, 200);
  assert.equal(upgraded.body.installation.status, 'installed');
  await request(fixture.origin, member, `/api/skills/${id}/enable`, { method: 'POST' });
  const rolledBack = await request(fixture.origin, member, `/api/skills/${id}/rollback`, {
    method: 'POST', body: JSON.stringify({ versionId: first.body.skill.version.id })
  });
  assert.equal(rolledBack.body.installation.status, 'installed');
  await request(fixture.origin, member, `/api/skills/${id}/enable`, { method: 'POST' });

  const disabled = await request(fixture.origin, owner, `/api/skills/${id}/disable`, { method: 'POST' });
  assert.equal(disabled.response.status, 200);
  assert.equal(disabled.body.skill.status, 'disabled');
  assert.equal((await request(fixture.origin, member, '/api/skills/installations')).body.installations[0].status, 'disabled');
  const denied = await request(fixture.origin, member, `/api/skills/${id}/enable`, { method: 'POST' });
  assert.equal(denied.response.status, 409);
  const archived = await request(fixture.origin, owner, `/api/skills/${id}/archive`, { method: 'POST' });
  assert.equal(archived.response.status, 200);
  assert.equal(archived.body.skill.status, 'archived');

  const actions = createAuditStore(fixture.db).list({ limit: 100 })
    .filter((event) => event.targetId === id).map((event) => event.action);
  for (const action of ['skill.version.create', 'skill.upgrade', 'skill.rollback', 'skill.disable', 'skill.archive']) {
    assert.ok(actions.includes(action));
  }
  assert.equal(JSON.stringify(createAuditStore(fixture.db).list({ limit: 100 })).includes('# Release 0.2.0'), false);
});
