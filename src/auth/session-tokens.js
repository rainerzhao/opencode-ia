'use strict';

const crypto = require('node:crypto');

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function hashToken(token) {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
    throw new TypeError('token is invalid');
  }
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function createToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function createSessionCredentials() {
  const token = createToken();
  const csrfToken = createToken();
  return {
    token,
    csrfToken,
    tokenHash: hashToken(token),
    csrfTokenHash: hashToken(csrfToken)
  };
}

function verifyTokenHash(token, expectedHash) {
  if (
    typeof token !== 'string' ||
    !TOKEN_PATTERN.test(token) ||
    typeof expectedHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(expectedHash)
  ) {
    return false;
  }
  const actual = Buffer.from(hashToken(token), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return crypto.timingSafeEqual(actual, expected);
}

module.exports = { createSessionCredentials, hashToken, verifyTokenHash };
