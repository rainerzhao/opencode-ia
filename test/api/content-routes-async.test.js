'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { createContentRouter } = require('../../src/modules/content/routes');

test('creates private knowledge through an asynchronous durable Store', async (t) => {
  const events = [];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.auth = { user: { id: 'member-1', role: 'member' } }; next(); });
  app.use(createContentRouter({
    store: {
      async createKnowledgeDraft(input) {
        return { id: 'knowledge-async-1', version: 1, status: 'draft', visibility: 'private', title: input.title };
      }
    },
    requestAuditor: { record(_req, event) { events.push(event); } }
  }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: { code: error.code || 'INTERNAL' } }));
  const server = http.createServer(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/knowledge`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Async knowledge', category: 'gateway', tags: [], markdown: '# Durable' })
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).knowledge.id, 'knowledge-async-1');
  assert.equal(events[0].targetId, 'knowledge-async-1');
});
