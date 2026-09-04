'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createOpenCodeClient } = require('../../src/gateway/opencode-client');
const { createFakeOpenCodeServer } = require('../fixtures/fake-opencode-server');

async function useServer(t, options) {
  const server = createFakeOpenCodeServer(options);
  const endpoint = await server.start();
  t.after(() => server.stop());
  return { server, endpoint };
}

test('uses authenticated loopback HTTP calls for health and session lifecycle', async (t) => {
  const { server, endpoint } = await useServer(t);
  const client = createOpenCodeClient({
    endpoint,
    username: 'opencode',
    password: 'worker-secret',
    expectedVersion: '1.18.25'
  });

  assert.deepEqual(await client.health(), { healthy: true, version: '1.18.25' });
  const session = await client.createSession({
    directory: '/safe/workspace',
    title: 'GPU 对话',
    agent: 'build',
    model: { id: 'deepseek-chat', providerID: 'deepseek' }
  });
  const response = await client.prompt({
    sessionId: session.id,
    directory: '/safe/workspace',
    text: '比较两种 GPU'
  });
  assert.equal((await client.getSession({
    sessionId: session.id,
    directory: '/safe/workspace'
  })).id, session.id);
  assert.equal(await client.abortSession({
    sessionId: session.id,
    directory: '/safe/workspace'
  }), true);

  assert.equal(session.directory, '/safe/workspace');
  assert.equal(response.parts[0].text, 'fake answer');
  assert.equal(server.requests.every((request) => request.authorization?.startsWith('Basic ')), true);
  const promptRequest = server.requests.find((request) => request.pathname.endsWith('/message'));
  assert.deepEqual(promptRequest.query, { directory: '/safe/workspace' });
  assert.deepEqual(promptRequest.body, {
    parts: [{ type: 'text', text: '比较两种 GPU' }]
  });
});

test('subscribes to parsed OpenCode events with the same directory boundary', async (t) => {
  const { server, endpoint } = await useServer(t);
  const client = createOpenCodeClient({ endpoint, username: 'opencode', password: 'worker-secret' });
  const events = [];

  await client.subscribeEvents({
    directory: '/safe/workspace',
    onEvent: (event) => events.push(event)
  });

  assert.deepEqual(events.map((event) => event.type), ['message.part.updated', 'session.idle']);
  const request = server.requests.find((item) => item.pathname === '/event');
  assert.deepEqual(request.query, { directory: '/safe/workspace' });
});

test('maps version drift, timeouts, caller cancellation, and API failures to safe errors', async (t) => {
  const oldServer = await useServer(t, { version: '1.17.0' });
  const oldClient = createOpenCodeClient({
    endpoint: oldServer.endpoint,
    username: 'opencode',
    password: 'worker-secret',
    expectedVersion: '1.18.25'
  });
  await assert.rejects(
    oldClient.health(),
    (error) => error.code === 'OPENCODE_VERSION_MISMATCH' && !error.message.includes('worker-secret')
  );

  const slowServer = await useServer(t, { healthDelayMs: 100 });
  const slowClient = createOpenCodeClient({
    endpoint: slowServer.endpoint,
    username: 'opencode',
    password: 'worker-secret',
    requestTimeoutMs: 20
  });
  await assert.rejects(
    slowClient.health(),
    (error) => error.code === 'OPENCODE_TIMEOUT'
  );

  const slowBodyServer = await useServer(t, { healthBodyDelayMs: 100 });
  const slowBodyClient = createOpenCodeClient({
    endpoint: slowBodyServer.endpoint,
    username: 'opencode',
    password: 'worker-secret',
    requestTimeoutMs: 20
  });
  await assert.rejects(
    slowBodyClient.health(),
    (error) => error.code === 'OPENCODE_TIMEOUT'
  );

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    slowClient.health({ signal: controller.signal }),
    (error) => error.code === 'OPENCODE_ABORTED'
  );

  await assert.rejects(
    slowClient.requestJson('/fail'),
    (error) => error.code === 'OPENCODE_API_ERROR' && !error.message.includes('provider secret')
  );
});

test('rejects non-loopback endpoints before sending credentials', () => {
  assert.throws(
    () => createOpenCodeClient({
      endpoint: 'http://192.0.2.10:4096',
      username: 'opencode',
      password: 'worker-secret'
    }),
    (error) => error.code === 'OPENCODE_ENDPOINT_UNSAFE'
  );
});
