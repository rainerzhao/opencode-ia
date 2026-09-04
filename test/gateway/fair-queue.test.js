'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFairQueue } = require('../../src/gateway/fair-queue');

function job(id, userId, conversationId = `${userId}-conversation`) {
  return { id, userId, conversationId };
}

test('selects users round-robin while preserving FIFO within each user', () => {
  const queue = createFairQueue({ maxQueuedPerUser: 3 });
  queue.enqueue(job('a-1', 'user-a'));
  queue.enqueue(job('a-2', 'user-a'));
  queue.enqueue(job('b-1', 'user-b'));
  queue.enqueue(job('c-1', 'user-c'));
  queue.enqueue(job('b-2', 'user-b'));

  assert.deepEqual(
    Array.from({ length: 5 }, () => queue.nextEligible()).map((item) => item.id),
    ['a-1', 'b-1', 'c-1', 'a-2', 'b-2']
  );
  assert.equal(queue.nextEligible(), null);
});

test('skips temporarily ineligible users without starving eligible work', () => {
  const queue = createFairQueue({ maxQueuedPerUser: 3 });
  queue.enqueue(job('a-1', 'user-a'));
  queue.enqueue(job('b-1', 'user-b'));
  queue.enqueue(job('c-1', 'user-c'));

  assert.equal(queue.nextEligible((item) => item.userId !== 'user-a').id, 'b-1');
  assert.equal(queue.nextEligible((item) => item.userId !== 'user-a').id, 'c-1');
  assert.equal(queue.nextEligible((item) => item.userId !== 'user-a'), null);
  assert.equal(queue.nextEligible().id, 'a-1');
});

test('rejects a fourth queued job for one user without affecting other users', () => {
  const queue = createFairQueue({ maxQueuedPerUser: 3 });
  for (const id of ['a-1', 'a-2', 'a-3']) queue.enqueue(job(id, 'user-a'));

  assert.throws(
    () => queue.enqueue(job('a-4', 'user-a')),
    (error) => error.code === 'USER_QUEUE_LIMIT'
  );
  assert.equal(queue.enqueue(job('b-1', 'user-b')).id, 'b-1');
  assert.deepEqual(queue.snapshot(), {
    totalQueued: 4,
    users: [
      { userId: 'user-a', queued: 3 },
      { userId: 'user-b', queued: 1 }
    ]
  });
});

test('removes a queued job and cleans up an empty user ring entry', () => {
  const queue = createFairQueue({ maxQueuedPerUser: 3 });
  queue.enqueue(job('a-1', 'user-a'));
  queue.enqueue(job('b-1', 'user-b'));

  assert.deepEqual(queue.remove('a-1'), job('a-1', 'user-a'));
  assert.equal(queue.remove('missing'), null);
  assert.deepEqual(queue.snapshot(), {
    totalQueued: 1,
    users: [{ userId: 'user-b', queued: 1 }]
  });
  assert.equal(queue.nextEligible().id, 'b-1');
});

test('rejects duplicate job ids and invalid queue configuration', () => {
  assert.throws(() => createFairQueue({ maxQueuedPerUser: 0 }), TypeError);
  const queue = createFairQueue({ maxQueuedPerUser: 3 });
  queue.enqueue(job('a-1', 'user-a'));
  assert.throws(
    () => queue.enqueue(job('a-1', 'user-b')),
    (error) => error.code === 'DUPLICATE_QUEUED_JOB'
  );
});
