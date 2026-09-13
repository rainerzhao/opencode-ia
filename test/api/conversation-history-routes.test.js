'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { createConversationRouter } = require('../../src/modules/conversations/routes');

test('serves owner-only paginated conversation events independently of WebSocket replay', async (t) => {
  const calls = []; const store = {
    async getLatestEventSequence({ conversationId, ownerUserId }) { calls.push(['latest', conversationId, ownerUserId]); return ownerUserId === 'owner' ? 1005 : null; },
    async listEventsAfter(input) { calls.push(['events', input]); return [{ sequence: 1001, type: 'message.created' }, { sequence: 1002, type: 'job.completed' }]; }
  };
  const app = express(); app.use((req, _res, next) => { req.auth = { user: { id: req.get('x-user') || 'owner' } }; next(); }); app.use(createConversationRouter({ store, requestAuditor: { record() {} } })); app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: { code: error.code } }));
  const server = http.createServer(app); t.after(() => new Promise((resolve) => server.close(resolve))); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/conversation-1/events?afterSequence=1000&limit=2`); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { events: [{ sequence: 1001, type: 'message.created' }, { sequence: 1002, type: 'job.completed' }], nextAfterSequence: 1002, hasMore: true });
  const denied = await fetch(`${base}/conversation-1/events`, { headers: { 'x-user': 'other' } }); assert.equal(denied.status, 404); assert.deepEqual(await denied.json(), { error: { code: 'CONVERSATION_NOT_FOUND' } });
  for (const query of ['?limit=1001', '?afterSequence=-1', '?limit=abc', '?afterSequence=1.2']) { const bad = await fetch(`${base}/conversation-1/events${query}`); assert.equal(bad.status, 400); }
  assert.deepEqual(calls[0], ['latest', 'conversation-1', 'owner']);
});
