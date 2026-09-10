'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const WebSocket = require('ws');
const { attachGatewaySocket } = require('../../src/modules/gateway/routes');

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = WebSocket.OPEN;
    this.sent = [];
    this.closeArgs = null;
  }

  send(payload) { this.sent.push(JSON.parse(payload)); }

  close(code, reason) {
    this.closeArgs = { code, reason };
    this.readyState = WebSocket.CLOSED;
    this.emit('close');
  }
}

async function eventually(check, message = 'condition was not reached') {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(message);
}

test('waits for asynchronous authentication before handling a Gateway message', async () => {
  const ws = new FakeSocket();
  let releaseAuthentication;
  const authenticated = new Promise((resolve) => { releaseAuthentication = resolve; });
  let subscribedUserId = null;
  attachGatewaySocket({
    ws,
    req: { authToken: 'opaque-session-token' },
    authService: { authenticate: () => authenticated },
    gatewayService: {
      subscribe({ userId }) {
        subscribedUserId = userId;
        return () => {};
      }
    },
    requestAuditor: { record() {} },
    session: { id: 'gateway-test-session' }
  });

  ws.emit('message', Buffer.from(JSON.stringify({
    type: 'subscribe', conversationId: 'conversation-1', afterSequence: 0
  })), false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(subscribedUserId, null);

  releaseAuthentication({ user: { id: 'member-1', role: 'member' }, session: { id: 'login-1' } });
  await eventually(() => subscribedUserId !== null);
  assert.equal(subscribedUserId, 'member-1');
  assert.equal(ws.closeArgs, null);
});
