'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const PARAMS = Object.freeze({ N: 16384, r: 8, p: 1 });
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const MAX_MEMORY = 64 * 1024 * 1024;

function passwordPolicyError() {
  const error = new Error('password must contain 12 to 128 characters');
  error.code = 'PASSWORD_POLICY';
  return error;
}

function validatePassword(password) {
  if (typeof password !== 'string') throw passwordPolicyError();
  const length = Array.from(password).length;
  if (length < 12 || length > 128) throw passwordPolicyError();
}

async function derive(password, salt) {
  return scrypt(password, salt, KEY_BYTES, { ...PARAMS, maxmem: MAX_MEMORY });
}

async function hashPassword(password) {
  validatePassword(password);
  const salt = crypto.randomBytes(SALT_BYTES);
  const key = await derive(password, salt);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || typeof encoded !== 'string') return false;
  const parts = encoded.split('$');
  if (parts.length !== 6) return false;

  const [algorithm, n, r, p, saltHex, keyHex] = parts;
  if (
    algorithm !== 'scrypt' ||
    n !== String(PARAMS.N) ||
    r !== String(PARAMS.r) ||
    p !== String(PARAMS.p) ||
    !/^[a-f0-9]{32}$/.test(saltHex) ||
    !/^[a-f0-9]{128}$/.test(keyHex)
  ) {
    return false;
  }

  try {
    const actual = await derive(password, Buffer.from(saltHex, 'hex'));
    const expected = Buffer.from(keyHex, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

module.exports = { hashPassword, verifyPassword };
