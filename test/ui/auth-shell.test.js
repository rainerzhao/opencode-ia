'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createAuthClient, getCookieValue } = require('../../public/auth-client');

const publicDir = path.resolve(__dirname, '../../public');

test('serves an accessible login form without embedding credentials or token storage', () => {
  const html = fs.readFileSync(path.join(publicDir, 'login.html'), 'utf8');

  assert.match(html, /<form[^>]+id="loginForm"/);
  assert.match(html, /<label[^>]+for="username"/);
  assert.match(html, /<input[^>]+id="username"[^>]+autocomplete="username"/);
  assert.match(html, /<label[^>]+for="password"/);
  assert.match(html, /<input[^>]+id="password"[^>]+type="password"[^>]+autocomplete="current-password"/);
  assert.match(html, /role="alert"/);
  assert.doesNotMatch(html, /localStorage|sessionStorage|api[_-]?key/i);
});

test('adds CSRF only to authenticated unsafe requests and never exposes a session token', async () => {
  const calls = [];
  const fakeFetch = async (url, options = {}) => {
    calls.push({ url, options, headers: new Headers(options.headers) });
    return new Response(JSON.stringify({ user: { id: 'user-1', role: 'member' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
  const client = createAuthClient({
    fetchImpl: fakeFetch,
    readCookie: () => 'workbench_csrf=csrf-value'
  });

  const login = await client.login('member.one', 'Member Password 2026!');
  assert.deepEqual(login, { user: { id: 'user-1', role: 'member' } });
  assert.equal(Object.hasOwn(login, 'token'), false);
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].headers.has('x-csrf-token'), false);

  await client.request('/api/knowledge/article', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  });
  assert.equal(calls[1].headers.get('x-csrf-token'), 'csrf-value');

  await client.request('/api/config');
  assert.equal(calls[2].headers.has('x-csrf-token'), false);
});

test('parses one unambiguous CSRF cookie and rejects duplicates or malformed values', () => {
  assert.equal(getCookieValue('theme=light; workbench_csrf=abc%20123', 'workbench_csrf'), 'abc 123');
  assert.equal(getCookieValue('workbench_csrf=one; workbench_csrf=two', 'workbench_csrf'), null);
  assert.equal(getCookieValue('workbench_csrf=%E0%A4%A', 'workbench_csrf'), null);
});

test('rejects cross-origin requests before a CSRF value can leave the workbench', async () => {
  let called = false;
  const client = createAuthClient({
    fetchImpl: async () => {
      called = true;
      return new Response(null, { status: 204 });
    },
    readCookie: () => 'workbench_csrf=private-csrf',
    baseOrigin: 'http://workbench.local'
  });

  await assert.rejects(
    client.request('https://outside.example/api/write', { method: 'POST' }),
    (error) => error.code === 'CROSS_ORIGIN_REQUEST'
  );
  assert.equal(called, false);
});

test('includes current-user controls and an admin-only account management surface', () => {
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');

  assert.match(html, /id="currentUser"/);
  assert.match(html, /id="logoutBtn"/);
  assert.match(html, /data-role="admin"/);
  assert.match(html, /id="page-admin"/);
  assert.match(html, /id="createUserForm"/);
  assert.match(html, /id="userList"/);
  assert.match(html, /<dialog[^>]+id="resetPasswordDialog"/);
  assert.match(html, /<form[^>]+id="resetPasswordForm"/);
  assert.match(html, /<input[^>]+id="resetNewPassword"[^>]+type="password"[^>]+autocomplete="new-password"/);
  assert.match(html, /<script src="auth-client\.js"><\/script>/);
});
