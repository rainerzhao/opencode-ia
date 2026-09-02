'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  readCookie,
  serializeAuthCookies,
  serializeClearedAuthCookies
} = require('../../src/http/cookies');

test('serializes an HttpOnly session cookie and a readable CSRF cookie with matching scope', () => {
  const headers = serializeAuthCookies({
    token: 'session-token',
    csrfToken: 'csrf-token',
    maxAgeSeconds: 3600,
    secure: true
  });

  assert.equal(headers.length, 2);
  assert.match(headers[0], /^workbench_session=session-token;/);
  assert.match(headers[0], /HttpOnly/);
  assert.match(headers[0], /Secure/);
  assert.match(headers[0], /SameSite=Lax/);
  assert.match(headers[0], /Path=\//);
  assert.match(headers[0], /Max-Age=3600/);
  assert.match(headers[1], /^workbench_csrf=csrf-token;/);
  assert.doesNotMatch(headers[1], /HttpOnly/);
  assert.match(headers[1], /Secure/);
  assert.match(headers[1], /SameSite=Lax/);
  assert.match(headers[1], /Path=\//);
});
test('rejects duplicate or malformed cookie values instead of choosing an ambiguous credential', () => {
  assert.equal(readCookie('a=1; workbench_session=abc; b=2', 'workbench_session'), 'abc');
  assert.equal(readCookie('workbench_session=one; workbench_session=two', 'workbench_session'), null);
  assert.equal(readCookie('workbench_session=%ZZ', 'workbench_session'), null);
  assert.equal(readCookie(undefined, 'workbench_session'), null);
});

test('clears both auth cookies using the same security attributes', () => {
  const headers = serializeClearedAuthCookies({ secure: false });
  assert.equal(headers.length, 2);
  for (const header of headers) {
    assert.match(header, /Max-Age=0/);
    assert.match(header, /SameSite=Lax/);
    assert.match(header, /Path=\//);
    assert.doesNotMatch(header, /Secure/);
  }
  assert.match(headers[0], /HttpOnly/);
  assert.doesNotMatch(headers[1], /HttpOnly/);
});
