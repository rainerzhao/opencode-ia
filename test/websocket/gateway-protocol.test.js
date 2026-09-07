'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { authHeaders, createAuthenticatedWorkbench, readJson } = require('../fixtures/authenticated-workbench');
const { GATEWAY_EVENT_TYPES } = require('../../packages/shared/gateway-events');

async function eventually(check, message = 'condition was not reached') {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(message);
}

function createFakeGateway(store) {
  const subscriptions = new Map();
  function publish(conversationId, userId) {
    const events = store.listEventsAfter({ conversationId, ownerUserId: userId, afterSequence: 0 }) || [];
    for (const subscriber of subscriptions.get(conversationId) || []) {
      for (const event of events) {
        if (event.sequence > subscriber.cursor) {
          subscriber.cursor = event.sequence;
          subscriber.onEvent(event);
        }
      }
    }
  }
  return {
    start: async () => {},
    stop: async () => {},
    subscribe({ conversationId, userId, afterSequence, onEvent }) {
      const conversation = store.getOwnedConversation({ id: conversationId, ownerUserId: userId });
      if (!conversation) throw Object.assign(new Error('not found'), { code: 'CONVERSATION_NOT_FOUND' });
      const events = store.listEventsAfter({ conversationId, ownerUserId: userId, afterSequence: 0 }) || [];
      const latest = events.at(-1)?.sequence || 0;
      const subscriber = { cursor: afterSequence, onEvent };
      if (afterSequence === 0 || afterSequence > latest) {
        onEvent({
          type: GATEWAY_EVENT_TYPES.CONVERSATION_SNAPSHOT,
          conversationId,
          jobId: null,
          sequence: afterSequence > latest ? latest : 0,
          occurredAt: '2026-09-04T01:00:00.000Z',
          data: { conversation, recoveryBoundary: afterSequence > latest }
        });
        subscriber.cursor = afterSequence > latest ? latest : 0;
      }
      for (const event of events) {
        if (event.sequence > subscriber.cursor) {
          subscriber.cursor = event.sequence;
          onEvent(event);
        }
      }
      let listeners = subscriptions.get(conversationId);
      if (!listeners) subscriptions.set(conversationId, (listeners = new Set()));
      listeners.add(subscriber);
      return () => listeners.delete(subscriber);
    },
    submit({ conversationId, userId, idempotencyKey, inputText }) {
      const job = store.createJob({ conversationId, userId, idempotencyKey, inputText });
      if (job.deduplicated) return job;
      publish(conversationId, userId);
      store.transitionJob({ jobId: job.id, userId, event: 'start' });
      publish(conversationId, userId);
      if (inputText !== 'hold') {
        store.appendEvent({
          conversationId,
          jobId: job.id,
          type: GATEWAY_EVENT_TYPES.MESSAGE_DELTA,
          payload: { text: `answer:${inputText}` }
        });
        publish(conversationId, userId);
        store.transitionJob({ jobId: job.id, userId, event: 'complete' });
        publish(conversationId, userId);
      }
      return store.getJob({ id: job.id });
    },
    async cancel({ conversationId, jobId, userId }) {
      const job = store.getJob({ id: jobId, userId });
      if (!job || (conversationId && job.conversationId !== conversationId)) {
        throw Object.assign(new Error('not found'), { code: 'JOB_NOT_FOUND' });
      }
      const cancelled = store.transitionJob({ jobId, userId, event: 'cancel' });
      publish(job.conversationId, userId);
      return cancelled;
    }
  };
}

async function createConversation(fixture, member, title = 'Gateway conversation') {
  const response = await fetch(`${fixture.origin}/api/conversations`, {
    method: 'POST',
    headers: authHeaders(member, { json: true }),
    body: JSON.stringify({ title })
  });
  return (await readJson(response)).conversation;
}

function connect(fixture, member) {
  const ws = new WebSocket(`ws://127.0.0.1:${fixture.address.port}`, {
    headers: { cookie: member.cookie }
  });
  const messages = [];
  ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
  return { ws, messages };
}

test('subscribes, streams ordered job events, deduplicates, and resumes after a sequence', async (t) => {
  const fixture = await createAuthenticatedWorkbench(t, {
    gatewayServiceFactory: ({ store }) => createFakeGateway(store)
  });
  const member = await fixture.createMember({ username: 'gateway.member' });
  const conversation = await createConversation(fixture, member);
  const first = connect(fixture, member);
  t.after(() => first.ws.terminate());
  await eventually(() => first.messages.some((item) => item.type === 'connected'));

  first.ws.send(JSON.stringify({ type: 'subscribe', conversationId: conversation.id, afterSequence: 0 }));
  await eventually(() => first.messages.some((item) => item.type === 'conversation.snapshot'));
  first.ws.send(JSON.stringify({
    type: 'prompt',
    conversationId: conversation.id,
    text: 'hello',
    idempotencyKey: 'request-1'
  }));
  await eventually(() => first.messages.filter((item) => item.jobId).length >= 6);
  assert.deepEqual(
    first.messages.filter((item) => item.sequence > 0).map((item) => item.type),
    ['message.created', 'job.queued', 'job.started', 'message.delta', 'job.completed']
  );
  const accepted = first.messages.find((item) => item.type === 'job.accepted');
  first.ws.send(JSON.stringify({
    type: 'prompt', conversationId: conversation.id, text: 'hello', idempotencyKey: 'request-1'
  }));
  await eventually(() => first.messages.filter((item) => item.type === 'job.accepted').length === 2);
  assert.equal(first.messages.filter((item) => item.type === 'job.queued').length, 1);
  assert.equal(first.messages.filter((item) => item.type === 'job.accepted').at(-1).deduplicated, true);

  first.ws.close();
  await eventually(() => first.ws.readyState === WebSocket.CLOSED);
  fixture.workbench.gatewayService.submit({
    conversationId: conversation.id,
    userId: member.user.id,
    idempotencyKey: 'request-2',
    inputText: 'offline'
  });
  const second = connect(fixture, member);
  t.after(() => second.ws.terminate());
  await eventually(() => second.messages.some((item) => item.type === 'connected'));
  second.ws.send(JSON.stringify({
    type: 'subscribe',
    conversationId: conversation.id,
    afterSequence: first.messages.find((item) => item.type === 'message.delta').sequence
  }));
  await eventually(() => second.messages.some((item) => item.type === 'job.completed'));
  assert.equal(second.messages.some((item) => item.type === 'job.queued'), true);
  assert.equal(typeof accepted.jobId, 'string');
  assert.ok(accepted.jobId.length > 0);
});

test('returns a recovery snapshot for a stale cursor and enforces cancel ownership', async (t) => {
  const fixture = await createAuthenticatedWorkbench(t, {
    gatewayServiceFactory: ({ store }) => createFakeGateway(store)
  });
  const owner = await fixture.createMember({ username: 'cancel.owner' });
  const sibling = await fixture.createMember({ username: 'cancel.sibling' });
  const conversation = await createConversation(fixture, owner);
  const ownerSocket = connect(fixture, owner);
  const siblingSocket = connect(fixture, sibling);
  t.after(() => ownerSocket.ws.terminate());
  t.after(() => siblingSocket.ws.terminate());
  await eventually(() => ownerSocket.messages.some((item) => item.type === 'connected'));
  ownerSocket.ws.send(JSON.stringify({ type: 'subscribe', conversationId: conversation.id, afterSequence: 999 }));
  await eventually(() => ownerSocket.messages.some((item) => item.type === 'conversation.snapshot'));
  assert.equal(ownerSocket.messages.find((item) => item.type === 'conversation.snapshot').data.recoveryBoundary, true);

  ownerSocket.ws.send(JSON.stringify({
    type: 'prompt', conversationId: conversation.id, text: 'hold', idempotencyKey: 'hold-1'
  }));
  const accepted = await eventually(() => ownerSocket.messages.find((item) => item.type === 'job.accepted'));
  await eventually(() => siblingSocket.messages.some((item) => item.type === 'connected'));
  siblingSocket.ws.send(JSON.stringify({ type: 'cancel', conversationId: conversation.id, jobId: accepted.jobId }));
  await eventually(() => siblingSocket.messages.some((item) => item.type === 'error'));
  assert.equal(siblingSocket.messages.find((item) => item.type === 'error').code, 'JOB_NOT_FOUND');
  ownerSocket.ws.send(JSON.stringify({ type: 'cancel', conversationId: conversation.id, jobId: accepted.jobId }));
  await eventually(() => ownerSocket.messages.some((item) => item.type === 'job.cancelled'));
});

test('cancels an owned job over REST with CSRF and hides sibling jobs', async (t) => {
  const fixture = await createAuthenticatedWorkbench(t, {
    gatewayServiceFactory: ({ store }) => createFakeGateway(store)
  });
  const owner = await fixture.createMember({ username: 'rest.cancel.owner' });
  const sibling = await fixture.createMember({ username: 'rest.cancel.sibling' });
  const conversation = await createConversation(fixture, owner);
  const job = fixture.workbench.gatewayService.submit({
    conversationId: conversation.id,
    userId: owner.user.id,
    idempotencyKey: 'rest-hold-1',
    inputText: 'hold'
  });

  const missingCsrf = await fetch(
    `${fixture.origin}/api/conversations/${conversation.id}/jobs/${job.id}/cancel`,
    { method: 'POST', headers: { cookie: owner.cookie } }
  );
  assert.equal(missingCsrf.status, 403);
  assert.equal((await readJson(missingCsrf)).error.code, 'CSRF_INVALID');

  const hidden = await fetch(
    `${fixture.origin}/api/conversations/${conversation.id}/jobs/${job.id}/cancel`,
    { method: 'POST', headers: authHeaders(sibling) }
  );
  assert.equal(hidden.status, 404);
  assert.equal((await readJson(hidden)).error.code, 'JOB_NOT_FOUND');

  const wrongConversation = await createConversation(fixture, owner, 'Other conversation');
  const mismatched = await fetch(
    `${fixture.origin}/api/conversations/${wrongConversation.id}/jobs/${job.id}/cancel`,
    { method: 'POST', headers: authHeaders(owner) }
  );
  assert.equal(mismatched.status, 404);
  assert.equal((await readJson(mismatched)).error.code, 'JOB_NOT_FOUND');

  const cancelled = await fetch(
    `${fixture.origin}/api/conversations/${conversation.id}/jobs/${job.id}/cancel`,
    { method: 'POST', headers: authHeaders(owner) }
  );
  assert.equal(cancelled.status, 200);
  assert.equal((await readJson(cancelled)).job.status, 'cancelled');
});

test('revalidates authentication before every Gateway message', async (t) => {
  const fixture = await createAuthenticatedWorkbench(t, {
    gatewayServiceFactory: ({ store }) => createFakeGateway(store)
  });
  const member = await fixture.createMember({ username: 'gateway.revoked' });
  const socket = connect(fixture, member);
  t.after(() => socket.ws.terminate());
  await eventually(() => socket.messages.some((item) => item.type === 'connected'));

  fixture.db.prepare(`
    UPDATE login_sessions SET revoked_at = ?
    WHERE user_id = ? AND revoked_at IS NULL
  `).run(new Date().toISOString(), member.user.id);
  const closed = new Promise((resolve) => {
    socket.ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
  });
  socket.ws.send(JSON.stringify({ type: 'subscribe', conversationId: 'hidden', afterSequence: 0 }));

  assert.deepEqual(await closed, { code: 1008, reason: 'AUTHENTICATION_REQUIRED' });
});

test('closes a Gateway socket before parsing an oversized message', async (t) => {
  const fixture = await createAuthenticatedWorkbench(t, {
    gatewayServiceFactory: ({ store }) => createFakeGateway(store)
  });
  const member = await fixture.createMember({ username: 'gateway.oversized' });
  const socket = connect(fixture, member);
  t.after(() => socket.ws.terminate());
  await eventually(() => socket.messages.some((item) => item.type === 'connected'));
  let closeCode;
  socket.ws.once('close', (code) => { closeCode = code; });

  socket.ws.send(JSON.stringify({
    type: 'prompt',
    conversationId: 'conversation',
    idempotencyKey: 'oversized-1',
    text: 'x'.repeat(600 * 1024)
  }));

  await eventually(() => closeCode !== undefined, 'oversized socket was not closed');
  assert.equal(closeCode, 1009);
});
