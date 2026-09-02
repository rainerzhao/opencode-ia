'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createSessionCredentials,
  hashToken,
  verifyTokenHash
} = require('../../src/auth/session-tokens');

test('creates independent high-entropy session and CSRF credentials with only hashes for storage', () => {
  const first = createSessionCredentials();
  const second = createSessionCredentials();

  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(first.csrfToken, /^[A-Za-z0-9_-]{43}$/);
  assert.match(first.tokenHash, /^[a-f0-9]{64}$/);
  assert.match(first.csrfTokenHash, /^[a-f0-9]{64}$/);
  assert.notEqual(first.token, first.csrfToken);
  assert.notEqual(first.token, second.token);
  assert.equal(first.tokenHash, hashToken(first.token));
  assert.equal(first.csrfTokenHash, hashToken(first.csrfToken));
  assert.equal(JSON.stringify(first).includes('password'), false);
});
test('verifies a raw token against a stored digest without accepting malformed values', () => {
  const credentials = createSessionCredentials();
  assert.equal(verifyTokenHash(credentials.token, credentials.tokenHash), true);
  assert.equal(verifyTokenHash(`${credentials.token}x`, credentials.tokenHash), false);
  assert.equal(verifyTokenHash(credentials.token, 'not-a-digest'), false);
  assert.equal(verifyTokenHash(null, credentials.tokenHash), false);
});
