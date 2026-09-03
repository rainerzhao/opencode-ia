'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createAuditStore } = require('../../src/audit/audit-store');
const { createAuthenticatedWorkbench } = require('../fixtures/authenticated-workbench');

function openWebSocket(url, options) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, options);
    ws.once('open', () => resolve({ ws, opened: true }));
    ws.once('unexpected-response', (_request, response) => {
      response.resume();
      resolve({ ws, opened: false, statusCode: response.statusCode });
    });
    ws.once('error', () => {});
  });
}

function waitForJson(ws, predicate = () => true, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('timed out waiting for WebSocket message'));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timeout);
      ws.off('message', onMessage);
      ws.off('error', onError);
    }
    function onMessage(data) {
      const message = JSON.parse(data.toString());
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    }
    function onError(error) {
      cleanup();
      reject(error);
    }
    ws.on('message', onMessage);
    ws.on('error', onError);
  });
}

function waitForClose(ws, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timed out waiting for WebSocket close')), timeoutMs);
    ws.once('close', (code, reason) => {
      clearTimeout(timeout);
      resolve({ code, reason: reason.toString() });
    });
  });
}

test('rejects anonymous WebSocket upgrades with HTTP 401', async (t) => {
  const fixture = await createAuthenticatedWorkbench(t);
  const result = await openWebSocket(`ws://127.0.0.1:${fixture.address.port}`);

  assert.equal(result.opened, false);
  assert.equal(result.statusCode, 401);
});

test('rejects a cross-origin WebSocket upgrade even when it carries a valid session cookie', async (t) => {
  const fixture = await createAuthenticatedWorkbench(t);
  const result = await openWebSocket(`ws://127.0.0.1:${fixture.address.port}`, {
    origin: 'https://attacker.example.com',
    headers: { cookie: fixture.admin.cookie }
  });

  assert.equal(result.opened, false);
  assert.equal(result.statusCode, 403);
});

test('binds WebSocket runtime identity to the authenticated login session and audits prompts', async (t) => {
  let observedInput;
  const fixture = await createAuthenticatedWorkbench(t, {
    promptRunner: {
      async runPrompt(input) {
        observedInput = input;
        return { text: 'ok', events: [], stderr: '' };
      }
    }
  });
  const member = await fixture.createMember({ username: 'socket.user', displayName: 'Socket User' });
  const ws = new WebSocket(`ws://127.0.0.1:${fixture.address.port}`, {
    headers: { cookie: member.cookie }
  });
  t.after(() => ws.terminate());

  const connected = await waitForJson(ws, (message) => message.type === 'connected');
  const runtime = fixture.workbench.sessions.get(connected.sessionId);
  const loginSession = fixture.db.prepare(`
    SELECT id FROM login_sessions
    WHERE user_id = ? AND revoked_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  `).get(member.user.id);
  assert.deepEqual(
    { userId: runtime.userId, role: runtime.role, loginSessionId: runtime.loginSessionId },
    { userId: member.user.id, role: 'member', loginSessionId: loginSession.id }
  );

  ws.send(JSON.stringify({ type: 'input', data: 'private prompt body' }));
  await waitForJson(ws, (message) => message.type === 'done');
  assert.equal(observedInput, 'private prompt body');

  const audit = createAuditStore(fixture.db).list({ limit: 100 });
  const event = audit.find((item) => item.action === 'opencode.prompt.run');
  assert.equal(event.actorUserId, member.user.id);
  assert.equal(event.targetId, connected.sessionId);
  assert.equal(event.metadata.inputLength, 19);
  assert.equal(JSON.stringify(event).includes('private prompt body'), false);
});

test('revalidates the login session before each prompt and closes revoked sockets', async (t) => {
  let runCount = 0;
  const fixture = await createAuthenticatedWorkbench(t, {
    promptRunner: {
      async runPrompt() {
        runCount += 1;
        return { text: 'must not run', events: [], stderr: '' };
      }
    }
  });
  const member = await fixture.createMember({ username: 'revoked.socket', displayName: 'Revoked Socket' });
  const ws = new WebSocket(`ws://127.0.0.1:${fixture.address.port}`, {
    headers: { cookie: member.cookie }
  });
  t.after(() => ws.terminate());
  await waitForJson(ws, (message) => message.type === 'connected');

  fixture.db.prepare(`
    UPDATE login_sessions SET revoked_at = ?
    WHERE user_id = ? AND revoked_at IS NULL
  `).run(new Date().toISOString(), member.user.id);
  const closed = waitForClose(ws);
  ws.send(JSON.stringify({ type: 'input', data: 'must not reach OpenCode' }));

  assert.deepEqual(await closed, { code: 1008, reason: 'AUTHENTICATION_REQUIRED' });
  assert.equal(runCount, 0);
});
