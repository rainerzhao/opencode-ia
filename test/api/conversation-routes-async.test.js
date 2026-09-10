'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { createConversationRouter } = require('../../src/modules/conversations/routes');

test('creates a Conversation through an asynchronous durable store', async (t) => {
  const calls = [];
  const store = {
    async createConversation(input) {
      calls.push(input);
      return { id: 'async-conversation-1', ownerUserId: input.ownerUserId, title: input.title, status: 'active' };
    }
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.auth = { user: { id: 'member-1' } }; next(); });
  app.use(createConversationRouter({ store, requestAuditor: { record(_req, event) { calls.push(event); } } }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: { code: error.code || 'INTERNAL' } }));
  const server = http.createServer(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Async durable conversation' })
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).conversation.id, 'async-conversation-1');
  assert.deepEqual(calls.at(-1), {
    action: 'conversation.create', targetType: 'conversation', targetId: 'async-conversation-1', metadata: { visibility: 'private' }
  });
});
