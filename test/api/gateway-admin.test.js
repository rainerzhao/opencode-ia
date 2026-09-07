'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthenticatedWorkbench, authHeaders } = require('../fixtures/authenticated-workbench');
const { createGatewayStore } = require('../../src/gateway/gateway-store');
const { createGatewayService } = require('../../src/gateway/gateway-service');
const { createFairQueue } = require('../../src/gateway/fair-queue');

test('administrator sees only operational metadata and cancellation requires role and CSRF', async (t) => {
  const fixture = await createAuthenticatedWorkbench(t, {
    gatewayServiceFactory: ({ store }) => ({
      snapshot: () => ({ status: 'running', running: 0, queue: { totalQueued: 1 }, pool: { workers: [{ id: 'worker-1', status: 'healthy', capacity: 1, running: 0, password: 'must-not-leak' }] } }),
      cancel: async ({ jobId, userId }) => store.transitionJob({ jobId, userId, event: 'cancel' })
    })
  });
  const member = await fixture.createMember({ username: 'operator.test' });
  const store = createGatewayStore(fixture.db);
  const conversation = store.createConversation({ ownerUserId: member.user.id, title: 'PRIVATE TITLE' });
  const job = store.createJob({ conversationId: conversation.id, userId: member.user.id, idempotencyKey: 'PRIVATE KEY', inputText: 'PRIVATE BODY' });
  for (const endpoint of ['health', 'workers', 'jobs']) {
    const url = `${fixture.origin}/api/admin/gateway/${endpoint}`;
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: authHeaders(member) })).status, 403);
    const response = await fetch(url, { headers: authHeaders(fixture.admin) });
    assert.equal(response.status, 200);
    assert.doesNotMatch(await response.text(), /PRIVATE|must-not-leak|inputText|password|idempotencyKey/);
  }
  const url = `${fixture.origin}/api/admin/gateway/jobs/${job.id}/cancel`;
  assert.equal((await fetch(url, { method: 'POST', headers: { cookie: fixture.admin.cookie } })).status, 403);
  assert.equal((await fetch(url, { method: 'POST', headers: authHeaders(member) })).status, 403);
  const cancelled = await fetch(url, { method: 'POST', headers: authHeaders(fixture.admin) });
  assert.equal(cancelled.status, 200);
  assert.doesNotMatch(await cancelled.text(), /PRIVATE|inputText|idempotencyKey/);
  assert.equal(store.getJob({ id: job.id }).status, 'cancelled');
  const audit = fixture.db.prepare("SELECT * FROM audit_logs WHERE action = 'gateway.admin.cancel'").get();
  assert.equal(audit.actor_user_id, 'user-admin');
  assert.equal(audit.target_id, job.id);
  assert.doesNotMatch(JSON.stringify(audit), /PRIVATE/);
});

test('gateway health reports degraded states and takes one consistent snapshot', async (t) => {
  let calls = 0;
  let state = { status: 'running', running: 0, queue: { totalQueued: 0 }, pool: { workers: [] } };
  const fixture = await createAuthenticatedWorkbench(t, {
    gatewayServiceFactory: () => ({ snapshot: () => { calls++; return state; } })
  });
  for (const [status, workers, expected] of [
    ['running', [], 'degraded'],
    ['running', [{ status: 'healthy' }, { status: 'failed' }], 'degraded'],
    ['stopped', [{ status: 'healthy' }], 'degraded'],
    ['running', [{ status: 'healthy' }, { status: 'healthy' }], 'healthy']
  ]) {
    state = { ...state, status, pool: { workers } };
    const before = calls;
    const response = await fetch(`${fixture.origin}/api/admin/gateway/health`, { headers: authHeaders(fixture.admin) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, expected);
    assert.equal(calls - before, 1);
  }
});

test('admin cancellation handles missing jobs and sanitizes upstream failures', async (t) => {
  const fixture = await createAuthenticatedWorkbench(t, {
    gatewayServiceFactory: () => ({ cancel: async () => { throw Object.assign(new Error('PRIVATE upstream password'), { status: 400, code: 'PRIVATE' }); } })
  });
  const store = createGatewayStore(fixture.db);
  const conversation = store.createConversation({ ownerUserId: 'user-admin', title: 'PRIVATE TITLE' });
  const job = store.createJob({ conversationId: conversation.id, userId: 'user-admin', idempotencyKey: 'PRIVATE KEY', inputText: 'PRIVATE BODY' });
  for (const id of ['unknown', 'invalid.id']) {
    const response = await fetch(`${fixture.origin}/api/admin/gateway/jobs/${id}/cancel`, { method: 'POST', headers: authHeaders(fixture.admin) });
    assert.equal(response.status, 404);
  }
  const response = await fetch(`${fixture.origin}/api/admin/gateway/jobs/${job.id}/cancel`, { method: 'POST', headers: authHeaders(fixture.admin) });
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /PRIVATE|password/);
  assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'gateway.admin.cancel'").get().count, 0);
});

test('admin cancellation uses real Gateway ownership and removes queued work idempotently', async (t) => {
  const queue = createFairQueue({ maxQueuedPerUser: 3 });
  const fixture = await createAuthenticatedWorkbench(t, {
    gatewayServiceFactory: ({ store }) => createGatewayService({
      store, queue, workspaceRoot: '/unused/admin-cancel-test',
      pool: { stop: async () => {}, snapshot: () => ({ workers: [] }) }
    })
  });
  const member = await fixture.createMember({ username: 'cancel.owner' });
  const store = createGatewayStore(fixture.db);
  const conversation = store.createConversation({ ownerUserId: member.user.id, title: 'PRIVATE TITLE' });
  const job = store.createJob({ conversationId: conversation.id, userId: member.user.id, idempotencyKey: 'PRIVATE KEY', inputText: 'PRIVATE BODY' });
  queue.enqueue(job);
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(`${fixture.origin}/api/admin/gateway/jobs/${job.id}/cancel`, { method: 'POST', headers: authHeaders(fixture.admin) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { job: { id: job.id, status: 'cancelled' } });
    assert.equal(queue.snapshot().totalQueued, 0);
  }
  assert.equal(store.getJob({ id: job.id }).userId, member.user.id);
});
