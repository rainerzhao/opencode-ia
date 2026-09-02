'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoginLimiter } = require('../../src/auth/login-limiter');

test('locks independently by normalized username and source IP after bounded failures', () => {
  let now = 1_000_000;
  const limiter = createLoginLimiter({
    maxFailures: 3,
    windowMs: 60_000,
    lockMs: 120_000,
    maxEntries: 100,
    now: () => now
  });
  const attempt = { username: ' Admin.User ', sourceIp: '127.0.0.1' };

  assert.deepEqual(limiter.check(attempt), { allowed: true, retryAfterSeconds: 0 });
  limiter.recordFailure(attempt);
  limiter.recordFailure(attempt);
  limiter.recordFailure(attempt);
  assert.deepEqual(limiter.check(attempt), { allowed: false, retryAfterSeconds: 120 });
  assert.equal(limiter.check({ username: 'other', sourceIp: '127.0.0.1' }).allowed, false);
  assert.equal(limiter.check({ username: 'admin.user', sourceIp: '127.0.0.2' }).allowed, false);

  now += 120_001;
  assert.deepEqual(limiter.check(attempt), { allowed: true, retryAfterSeconds: 0 });
});

test('successful login clears its username failures without erasing source failures', () => {
  const limiter = createLoginLimiter({ maxFailures: 3, now: () => 1_000_000 });
  const sharedSource = '10.0.0.8';
  limiter.recordFailure({ username: 'victim', sourceIp: sharedSource });
  limiter.recordFailure({ username: 'victim', sourceIp: sharedSource });
  limiter.recordFailure({ username: 'member', sourceIp: '10.0.0.9' });
  limiter.recordFailure({ username: 'member', sourceIp: '10.0.0.9' });

  limiter.recordSuccess({ username: 'member', sourceIp: sharedSource });
  assert.equal(limiter.check({ username: 'member', sourceIp: '10.0.0.10' }).allowed, true);

  limiter.recordFailure({ username: 'other', sourceIp: sharedSource });
  assert.equal(limiter.check({ username: 'fresh', sourceIp: sharedSource }).allowed, false);
});

test('caps tracked entries and prunes expired failures', () => {
  let now = 1_000_000;
  const limiter = createLoginLimiter({
    maxFailures: 3,
    windowMs: 100,
    lockMs: 100,
    maxEntries: 4,
    now: () => now
  });
  for (let index = 0; index < 10; index += 1) {
    limiter.recordFailure({ username: `user${index}`, sourceIp: `10.0.0.${index}` });
  }
  assert.ok(limiter.size() <= 4);
  now += 201;
  limiter.prune();
  assert.equal(limiter.size(), 0);
});
