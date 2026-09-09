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
    slug: 'validated-skill',
    displayName: 'Validated Skill',
    description: 'A private validation candidate',
    skillMd: [
      '---',
      'name: validated-skill',
      'description: Validate a safe team workflow',
      '---',
      '',
      '# Instructions',
      '',
      'Read references/guide.md and return a bounded result.'
    ].join('\n'),
    ...overrides
  };
}

async function createDraft(fixture, member, overrides = {}) {
  const created = await jsonRequest(fixture.origin, member, '/api/skills', {
    method: 'POST',
    body: JSON.stringify(draftBody(overrides))
  });
  assert.equal(created.response.status, 201);
  return created.body.skill;
}

test('stores bounded files and persists a failed report when runtime validation is unavailable', async (t) => {
  const fixture = await createAuthenticatedWorkbench(t);
  const member = await fixture.createMember({ username: 'validation.owner' });
  const skill = await createDraft(fixture, member);
  const files = [{ path: 'references/guide.md', content: '# Guide\n\nUse safe inputs.' }];

  const saved = await jsonRequest(fixture.origin, member, `/api/skills/${skill.id}/files`, {
    method: 'PUT', body: JSON.stringify({ files })
  });
  assert.equal(saved.response.status, 200);
  assert.deepEqual(saved.body.skill.files.map((file) => file.path), ['references/guide.md']);

  const validated = await jsonRequest(fixture.origin, member, `/api/skills/${skill.id}/validate`, {
    method: 'POST'
  });
  assert.equal(validated.response.status, 200);
  assert.equal(validated.body.skill.version.status, 'draft');
  assert.equal(validated.body.skill.version.validationReport.verdict, 'fail');
  assert.equal(validated.body.skill.version.validationReport.runtime.status, 'unavailable');

  const events = createAuditStore(fixture.db).list({ limit: 100 })
    .filter((item) => item.targetId === skill.id);
  assert.deepEqual(events.map((item) => item.action).sort(), [
    'skill.create', 'skill.files.replace', 'skill.validate'
  ]);
  assert.equal(JSON.stringify(events).includes('Use safe inputs'), false);
  assert.equal(JSON.stringify(events).includes(skill.version.skillMd), false);
});

test('marks a safe version validated only after the OpenCode runtime adapter passes', async (t) => {
  const calls = [];
  const fixture = await createAuthenticatedWorkbench(t, {
    skillRuntimeValidator: {
      async validate(input) {
        calls.push(input);
        return { status: 'passed', durationMs: 42 };
      }
    }
  });
  const member = await fixture.createMember({ username: 'validation.passed' });
  const skill = await createDraft(fixture, member);

  const validated = await jsonRequest(fixture.origin, member, `/api/skills/${skill.id}/validate`, {
    method: 'POST'
  });
  assert.equal(validated.response.status, 200);
  assert.equal(validated.body.skill.version.status, 'validated');
  assert.equal(validated.body.skill.version.validationReport.verdict, 'pass');
  assert.deepEqual(validated.body.skill.version.validationReport.runtime, {
    status: 'passed', provider: 'opencode-gateway', durationMs: 42
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].skillId, skill.id);
  assert.equal(calls[0].ownerUserId, member.user.id);

  const changed = await jsonRequest(fixture.origin, member, `/api/skills/${skill.id}`, {
    method: 'PATCH', body: JSON.stringify({ skillMd: draftBody().skillMd.replace('bounded', 'updated') })
  });
  assert.equal(changed.response.status, 200);
  assert.equal(changed.body.skill.version.status, 'draft');
  assert.deepEqual(changed.body.skill.version.validationReport, {});
});

test('skips runtime for static failures and denies sibling validation with 404 semantics', async (t) => {
  let runtimeCalls = 0;
  const fixture = await createAuthenticatedWorkbench(t, {
    skillRuntimeValidator: {
      async validate() {
        runtimeCalls += 1;
        return { status: 'passed' };
      }
    }
  });
  const owner = await fixture.createMember({ username: 'validation.private' });
  const sibling = await fixture.createMember({ username: 'validation.sibling' });
  const secret = 'DONTEXPOSETHISVALUE12345';
  const skill = await createDraft(fixture, owner, {
    skillMd: `---\nname: validated-skill\ndescription: Unsafe\n---\n# Instructions\napi_key = "${secret}"`
  });

  const failed = await jsonRequest(fixture.origin, owner, `/api/skills/${skill.id}/validate`, {
    method: 'POST'
  });
  assert.equal(failed.response.status, 200);
  assert.equal(failed.body.skill.version.validationReport.verdict, 'fail');
  assert.equal(failed.body.skill.version.validationReport.runtime.status, 'skipped');
  assert.equal(JSON.stringify(failed.body.skill.version.validationReport).includes(secret), false);
  assert.equal(runtimeCalls, 0);

  const denied = await jsonRequest(fixture.origin, sibling, `/api/skills/${skill.id}/validate`, {
    method: 'POST'
  });
  assert.equal(denied.response.status, 404);

  const noCsrf = await fetch(`${fixture.origin}/api/skills/${skill.id}/validate`, {
    method: 'POST', headers: { cookie: owner.cookie }
  });
  assert.equal(noCsrf.status, 403);
});

test('rejects a stale runtime result instead of validating changed content', async (t) => {
  let database;
  const fixture = await createAuthenticatedWorkbench(t, {
    skillRuntimeValidator: {
      async validate(input) {
        database.prepare(`
          UPDATE skill_versions SET content_sha256 = ? WHERE id = ?
        `).run('f'.repeat(64), input.versionId);
        return { status: 'passed', durationMs: 1 };
      }
    }
  });
  database = fixture.db;
  const member = await fixture.createMember({ username: 'validation.stale' });
  const skill = await createDraft(fixture, member);

  const response = await jsonRequest(fixture.origin, member, `/api/skills/${skill.id}/validate`, {
    method: 'POST'
  });
  assert.equal(response.response.status, 409);
  assert.equal(response.body.error.code, 'SKILL_VALIDATION_STALE');
  assert.equal(
    fixture.db.prepare('SELECT status FROM skill_versions WHERE id = ?').get(skill.version.id).status,
    'draft'
  );
});
