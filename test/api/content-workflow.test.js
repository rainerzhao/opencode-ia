'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuditStore } = require('../../src/audit/audit-store');
const { createGatewayStore } = require('../../src/gateway/gateway-store');
const { GATEWAY_EVENT_TYPES } = require('../../packages/shared/gateway-events');
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
  const restored = await fetch(`${fixture.origin}/api/content/solutions/${solution.id}/restore`, {
    method: 'POST', headers: authHeaders(author, { json: true }), body: JSON.stringify({ version: 1 })
  });
  assert.equal(restored.status, 200);
  assert.equal((await readJson(restored)).solution.version, 3);
  const restoredDetail = (await readJson(await fetch(`${fixture.origin}/api/content/solutions/${solution.id}`, { headers: { cookie: author.cookie } }))).solution;
  assert.equal(restoredDetail.solutionMarkdown, '# Cluster\nprivate');
  const restoreAudit = createAuditStore(fixture.db).list({ limit: 100 })
    .find((item) => item.action === 'content.solution.restore' && item.targetId === solution.id);
  assert.equal(restoreAudit.metadata.restoredFromVersion, 1);
  assert.equal(JSON.stringify(restoreAudit).includes('Cluster'), false);
});

test('converts only completed owned conversation turns into a private solution', async (t) => {
  const fixture = await createAuthenticatedWorkbench(t);
  const author = await fixture.createMember({ username: 'conversation.author', displayName: 'Conversation Author' });
  const viewer = await fixture.createMember({ username: 'conversation.viewer', displayName: 'Conversation Viewer' });
  const gateway = createGatewayStore(fixture.db, { clock: () => '2026-09-11T00:00:00.000Z' });
  const conversation = gateway.createConversation({ ownerUserId: author.user.id, title: '沉淀来源对话' });
  const job = gateway.createJob({ conversationId: conversation.id, userId: author.user.id, idempotencyKey: 'source-job-1', inputText: '请整理方案' });
  gateway.transitionJob({ jobId: job.id, userId: author.user.id, event: 'start' });
  gateway.appendEvent({ conversationId: conversation.id, jobId: job.id, type: GATEWAY_EVENT_TYPES.MESSAGE_DELTA, payload: { role: 'assistant', text: '# 已完成方案\n正文' } });
  gateway.transitionJob({ jobId: job.id, userId: author.user.id, event: 'complete' });

  const created = await fetch(`${fixture.origin}/api/content/solutions/from-conversation`, {
    method: 'POST', headers: authHeaders(author, { json: true }),
    body: JSON.stringify({ conversationId: conversation.id, title: '对话沉淀方案', description: '来自已完成对话' })
  });
  assert.equal(created.status, 201);
  const solution = (await readJson(created)).solution;
  const detail = await fetch(`${fixture.origin}/api/content/solutions/${solution.id}`, { headers: { cookie: author.cookie } });
  const ownerDetail = (await readJson(detail)).solution;
  assert.equal(ownerDetail.solutionMarkdown, '# 已完成方案\n正文');
  assert.equal(ownerDetail.references[0].firstSequence, 1);
  await fetch(`${fixture.origin}/api/content/solutions/${solution.id}/publish`, { method: 'POST', headers: authHeaders(author) });
  const viewerDetailResponse = await fetch(`${fixture.origin}/api/content/solutions/${solution.id}`, { headers: { cookie: viewer.cookie } });
  const viewerDetail = (await readJson(viewerDetailResponse)).solution;
  assert.equal(viewerDetail.references[0].private, true);
  assert.equal(viewerDetail.references[0].sourceId, undefined);
  assert.equal(viewerDetail.references[0].firstSequence, undefined);
});

test('converts an owned solution into a private knowledge draft', async (t) => {
  const fixture = await createAuthenticatedWorkbench(t);
  const author = await fixture.createMember({ username: 'solution.knowledge.author' });
  const viewer = await fixture.createMember({ username: 'solution.knowledge.viewer' });
  const created = await fetch(`${fixture.origin}/api/content/solutions`, {
    method: 'POST', headers: authHeaders(author, { json: true }),
    body: JSON.stringify({ title: '运行方案', solutionMarkdown: '# 运行方案' })
  });
  const solution = (await readJson(created)).solution;
  const noCsrf = await fetch(`${fixture.origin}/api/content/solutions/${solution.id}/to-knowledge`, {
    method: 'POST', headers: { cookie: author.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ markdown: '# 知识' })
  });
  assert.equal(noCsrf.status, 403);
  const converted = await fetch(`${fixture.origin}/api/content/solutions/${solution.id}/to-knowledge`, {
    method: 'POST', headers: authHeaders(author, { json: true }), body: JSON.stringify({ markdown: '# 知识', category: 'runtime', tags: ['gateway'] })
  });
  assert.equal(converted.status, 201);
  const knowledge = (await readJson(converted)).knowledge;
  assert.equal(knowledge.visibility, 'private');
  const blocked = await fetch(`${fixture.origin}/api/content/knowledge/${knowledge.id}`, { headers: { cookie: viewer.cookie } });
  assert.equal(blocked.status, 404);
});

test('stores a bounded private attachment against the current knowledge version', async (t) => {
  const fixture = await createAuthenticatedWorkbench(t);
  const author = await fixture.createMember({ username: 'attachment.author' });
  const created = await fetch(`${fixture.origin}/api/content/knowledge`, {
    method: 'POST', headers: authHeaders(author, { json: true }),
    body: JSON.stringify({ title: '带附件知识', markdown: '# 正文' })
  });
  const knowledge = (await readJson(created)).knowledge;
  const form = new FormData();
  form.append('file', new Blob(['# 附件内容'], { type: 'text/markdown' }), 'guide.md');
  const uploaded = await fetch(`${fixture.origin}/api/content/knowledge/${knowledge.id}/attachments`, {
    method: 'POST', headers: authHeaders(author), body: form
  });
  assert.equal(uploaded.status, 201);
  const attachment = (await readJson(uploaded)).attachment;
  assert.equal(attachment.originalName, 'guide.md');
  assert.equal(attachment.sizeBytes, Buffer.byteLength('# 附件内容'));
  const detail = (await readJson(await fetch(`${fixture.origin}/api/content/knowledge/${knowledge.id}`, { headers: { cookie: author.cookie } }))).knowledge;
  assert.equal(detail.attachments.length, 1);
  assert.equal(detail.attachments[0].contentSha256.length, 64);
  const downloaded = await fetch(`${fixture.origin}/api/content/knowledge/${knowledge.id}/attachments/${attachment.id}`, { headers: { cookie: author.cookie } });
  assert.equal(downloaded.status, 200);
  assert.equal(await downloaded.text(), '# 附件内容');
  const preview = await fetch(`${fixture.origin}/api/content/knowledge/${knowledge.id}/attachments/${attachment.id}/preview`, { headers: { cookie: author.cookie } });
  assert.equal(preview.status, 200);
  assert.deepEqual(await preview.json(), { attachmentId: attachment.id, format: 'md', truncated: false, text: '# 附件内容' });

  const exported = await fetch(`${fixture.origin}/api/content/knowledge/${knowledge.id}/export`, { headers: { cookie: author.cookie } });
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get('content-disposition'), /attachment/);
  const bundle = await exported.json();
  assert.equal(bundle.type, 'knowledge-bundle');
  assert.equal(bundle.schemaVersion, 1);
  assert.equal(bundle.knowledge.title, '带附件知识');
  assert.equal(bundle.attachments.length, 1);
  assert.equal(Buffer.from(bundle.attachments[0].contentBase64, 'base64').toString(), '# 附件内容');
  assert.equal(Object.hasOwn(bundle.attachments[0], 'storageKey'), false);
  assert.equal(createAuditStore(fixture.db).list({ limit: 100 }).some((item) => item.action === 'content.knowledge.export' && item.targetId === knowledge.id), true);

  const imported = await fetch(`${fixture.origin}/api/content/knowledge/import`, {
    method: 'POST', headers: authHeaders(author, { json: true }), body: JSON.stringify({
      type: bundle.type,
      schemaVersion: bundle.schemaVersion,
      knowledge: { ...bundle.knowledge, visibility: 'team', status: 'published', versionHistory: [{ version: 99 }] },
      attachments: bundle.attachments
    })
  });
  assert.equal(imported.status, 201);
  const importedKnowledge = (await readJson(imported)).knowledge;
  assert.notEqual(importedKnowledge.id, knowledge.id);
  assert.equal(importedKnowledge.visibility, 'private');
  assert.equal(importedKnowledge.status, 'draft');
  const importedDetail = (await readJson(await fetch(`${fixture.origin}/api/content/knowledge/${importedKnowledge.id}`, { headers: { cookie: author.cookie } }))).knowledge;
  assert.equal(importedDetail.attachments.length, 1);
  const importedDownload = await fetch(`${fixture.origin}/api/content/knowledge/${importedKnowledge.id}/attachments/${importedDetail.attachments[0].id}`, { headers: { cookie: author.cookie } });
  assert.equal(await importedDownload.text(), '# 附件内容');

  const rejectedImport = await fetch(`${fixture.origin}/api/content/knowledge/import`, {
    method: 'POST', headers: authHeaders(author, { json: true }), body: JSON.stringify({
      type: 'knowledge-bundle', schemaVersion: 1,
      knowledge: { title: '恶意导入', markdown: '# x' },
      attachments: [{ originalName: 'bad.md', mediaType: 'text/markdown', sizeBytes: 1, contentSha256: '0'.repeat(64), contentBase64: 'eA==' }]
    })
  });
  assert.equal(rejectedImport.status, 400);
});

test('returns owner-only Knowledge version diffs and hides private history from team viewers', async (t) => {
  const fixture = await createAuthenticatedWorkbench(t);
  const author = await fixture.createMember({ username: 'diff.author' });
  const viewer = await fixture.createMember({ username: 'diff.viewer' });
  const created = await fetch(`${fixture.origin}/api/content/knowledge`, {
    method: 'POST', headers: authHeaders(author, { json: true }),
    body: JSON.stringify({ title: '版本差异', markdown: '# 标题\n旧内容' })
  });
  const knowledge = (await readJson(created)).knowledge;
  const updated = await fetch(`${fixture.origin}/api/content/knowledge/${knowledge.id}`, {
    method: 'PATCH', headers: authHeaders(author, { json: true }),
    body: JSON.stringify({ markdown: '# 标题\n新内容\n新增一行' })
  });
  assert.equal((await readJson(updated)).knowledge.version, 2);
  const ownerDiff = await fetch(`${fixture.origin}/api/content/knowledge/${knowledge.id}/diff?from=1&to=2`, { headers: { cookie: author.cookie } });
  assert.equal(ownerDiff.status, 200);
  const diff = await ownerDiff.json();
  assert.deepEqual(diff.diff.summary, { additions: 2, removals: 1, unchanged: 1 });
  await fetch(`${fixture.origin}/api/content/knowledge/${knowledge.id}/publish`, { method: 'POST', headers: authHeaders(author) });
  const viewerDiff = await fetch(`${fixture.origin}/api/content/knowledge/${knowledge.id}/diff?from=1&to=2`, { headers: { cookie: viewer.cookie } });
  assert.equal(viewerDiff.status, 404);
  const restored = await fetch(`${fixture.origin}/api/content/knowledge/${knowledge.id}/restore`, {
    method: 'POST', headers: authHeaders(author, { json: true }), body: JSON.stringify({ version: 1 })
  });
  assert.equal(restored.status, 200);
  assert.equal((await readJson(restored)).knowledge.version, 4);
  const visible = (await readJson(await fetch(`${fixture.origin}/api/content/knowledge/${knowledge.id}`, { headers: { cookie: viewer.cookie } }))).knowledge;
  assert.equal(visible.markdown, '# 标题\n旧内容');
});
