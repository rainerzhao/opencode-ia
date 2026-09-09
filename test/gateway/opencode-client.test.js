'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createOpenCodeClient } = require('../../src/gateway/opencode-client');
const { createFakeOpenCodeServer } = require('../fixtures/fake-opencode-server');

test('submits prompts asynchronously and resolves the correlated completed assistant message', async () => {
  const requests = [];
  let messageReads = 0;
  const client = createOpenCodeClient({
    endpoint: 'http://127.0.0.1:4319',
    username: 'opencode',
    password: 'worker-secret',
    promptPollIntervalMs: 1,
    messageIdFactory: () => 'msg_user_expected',
    fetchImpl: async (url, options) => {
      const target = new URL(url);
      const body = options.body ? JSON.parse(options.body) : null;
      requests.push({ method: options.method, pathname: target.pathname, body });
      if (target.pathname.endsWith('/prompt_async') && options.method === 'POST') {
        return { ok: true, status: 204, json: async () => assert.fail('204 response has no JSON body') };
      }
      if (target.pathname.endsWith('/message') && options.method === 'GET') {
        messageReads += 1;
        return {
          ok: true,
          status: 200,
          json: async () => messageReads === 1 ? [] : [{
            info: {
              id: 'msg_assistant_expected',
              role: 'assistant',
              parentID: 'msg_user_expected',
              time: { created: 1, completed: 2 }
            },
            parts: [{ type: 'text', text: 'async answer' }]
          }]
        };
      }
      assert.fail(`unexpected request ${options.method} ${target.pathname}`);
    }
  });

  const response = await client.prompt({
    sessionId: 'ses_expected',
    directory: '/safe/workspace',
    text: 'hello',
    agent: 'build',
    tools: { bash: false }
  });

  assert.equal(response.parts[0].text, 'async answer');
  assert.equal(messageReads, 2);
  assert.deepEqual(requests[0], {
    method: 'POST',
    pathname: '/session/ses_expected/prompt_async',
    body: {
      messageID: 'msg_user_expected',
      parts: [{ type: 'text', text: 'hello' }],
      agent: 'build',
      tools: { bash: false }
    }
  });
});

test('rejects promptly when cancellation happens immediately before a poll delay', async () => {
  const controller = new AbortController();
  const client = createOpenCodeClient({
    endpoint: 'http://127.0.0.1:4319',
    username: 'opencode',
    password: 'worker-secret',
    promptTimeoutMs: 1000,
    promptPollIntervalMs: 500,
    messageIdFactory: () => 'msg_cancelled_poll',
    fetchImpl: async (url, { method }) => {
      const pathname = new URL(url).pathname;
      if (pathname.endsWith('/prompt_async') && method === 'POST') {
        return { ok: true, status: 204 };
      }
      controller.abort();
      return { ok: true, status: 200, json: async () => [] };
    }
  });

  const outcome = await Promise.race([
    client.prompt({
      sessionId: 'session-1',
      directory: '/safe/workspace',
      text: 'cancel me',
      signal: controller.signal
    }).then(
      () => ({ resolved: true }),
      (error) => ({ code: error.code })
    ),
    new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), 50))
  ]);

  assert.deepEqual(outcome, { code: 'OPENCODE_ABORTED' });
});

test('prompt deadline is independent from the short health deadline', async () => {
  const startedAt = Date.now();
  const messageId = 'msg_slow_answer';
  const client = createOpenCodeClient({
    endpoint: 'http://127.0.0.1:4319', username: 'opencode', password: 'worker-secret',
    requestTimeoutMs: 10, promptTimeoutMs: 200, healthTimeoutMs: 10,
    promptPollIntervalMs: 5,
    messageIdFactory: () => messageId,
    fetchImpl: (url, { method, signal }) => {
      const pathname = new URL(url).pathname;
      if (pathname === '/global/health') {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve({ ok: true, status: 200, json: async () => ({ healthy: true, version: '1.18.25' }) }), 40);
          signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }, { once: true });
        });
      }
      if (pathname.endsWith('/prompt_async') && method === 'POST') {
        return Promise.resolve({ ok: true, status: 204 });
      }
      if (pathname.endsWith('/message') && method === 'GET') {
        const completed = Date.now() - startedAt >= 40;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => completed ? [{
            info: { role: 'assistant', parentID: messageId, time: { completed: Date.now() } },
            parts: [{ text: 'slow answer' }]
          }] : []
        });
      }
      return Promise.reject(new Error('unexpected request'));
    }
  });
  assert.equal((await client.prompt({ sessionId: 'session-1', text: 'hello', directory: '/safe/workspace' })).parts[0].text, 'slow answer');
  await assert.rejects(client.health(), { code: 'OPENCODE_TIMEOUT' });
});

test('HTTP 200 model errors are not treated as successful empty replies', async () => {
  const messageId = 'msg_error_expected';
  const client = createOpenCodeClient({
    endpoint: 'http://127.0.0.1:4319', username: 'opencode', password: 'worker-secret',
    messageIdFactory: () => messageId,
    fetchImpl: async (url, { method }) => {
      const pathname = new URL(url).pathname;
      if (pathname.endsWith('/prompt_async') && method === 'POST') return { ok: true, status: 204 };
      return {
        ok: true,
        status: 200,
        json: async () => [{
          info: {
            role: 'assistant',
            parentID: messageId,
            time: { completed: Date.now() },
            error: { name: 'APIError', data: { message: 'PRIVATE KEY' } }
          },
          parts: []
        }]
      };
    }
  });
  await assert.rejects(client.prompt({ sessionId: 's1', directory: '/safe/workspace', text: 'hello' }), (error) => error.code === 'OPENCODE_MODEL_ERROR' && !error.message.includes('PRIVATE'));
});

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
    expectedVersion: '1.18.25',
    messageIdFactory: () => 'msg_user_1'
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
    text: '比较两种 GPU',
    tools: { bash: false, webfetch: false }
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
  const promptRequest = server.requests.find((request) => request.pathname.endsWith('/prompt_async'));
  assert.deepEqual(promptRequest.query, { directory: '/safe/workspace' });
  assert.deepEqual(promptRequest.body, {
    messageID: 'msg_user_1',
    parts: [{ type: 'text', text: '比较两种 GPU' }],
    tools: { bash: false, webfetch: false }
  });
});

test('rejects malformed per-prompt tool flags before sending a request', async () => {
  const client = createOpenCodeClient({
    endpoint: 'http://127.0.0.1:4319',
    username: 'opencode',
    password: 'worker-secret',
    fetchImpl: async () => assert.fail('malformed tools must not reach fetch')
  });
  await assert.rejects(
    client.prompt({
      sessionId: 'session-1',
      directory: '/safe/workspace',
      text: 'hello',
      tools: { bash: 'deny' }
    }),
    (error) => error.code === 'INVALID_OPENCODE_TOOLS'
  );
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
