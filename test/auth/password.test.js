'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword } = require('../../src/auth/password');

test('hashes a valid password with independent salts and verifies only the correct value', async () => {
  const password = 'Correct Horse 2026!';
  const first = await hashPassword(password);
  const second = await hashPassword(password);

  assert.match(first, /^scrypt\$16384\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  assert.notEqual(first, second);
  assert.equal(first.includes(password), false);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword('Wrong Password 2026!', first), false);
});

test('treats malformed stored hashes as an authentication failure', async () => {
  const malformed = [
    '',
    'plain-text-password',
    'scrypt$1$8$1$00$00',
    'scrypt$16384$8$1$not-hex$also-not-hex',
    null
  ];

  for (const stored of malformed) {
    assert.equal(await verifyPassword('Correct Horse 2026!', stored), false);
  }
});

test('enforces a 12 to 128 Unicode-character password policy', async () => {
  await assert.rejects(hashPassword('short-12345'), (error) => error.code === 'PASSWORD_POLICY');
  await assert.doesNotReject(hashPassword('十二个字符安全密码AB12'));
  await assert.rejects(hashPassword('a'.repeat(129)), (error) => error.code === 'PASSWORD_POLICY');
  await assert.rejects(hashPassword(null), (error) => error.code === 'PASSWORD_POLICY');
});
