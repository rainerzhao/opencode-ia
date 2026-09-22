'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCapacityAcceptanceProfile } = require('../../src/gateway/capacity-acceptance-profile');

test('uses the fast five-user profile unless a capacity acceptance is explicitly enabled', () => {
  assert.deepEqual(loadCapacityAcceptanceProfile({}), { users: 5, conversationsPerUser: 3, connectionsPerUser: 1, rounds: 3, workerCount: 1, workerCapacity: 5, executionSlots: 5, name: 'five-user' });
});

test('uses a bounded twenty-user profile with queued execution slots', () => {
  assert.deepEqual(loadCapacityAcceptanceProfile({ WORKBENCH_TWENTY_USER_ACCEPTANCE: '1' }), { users: 20, conversationsPerUser: 3, connectionsPerUser: 1, rounds: 3, workerCount: 1, workerCapacity: 5, executionSlots: 5, name: 'twenty-user' });
});

test('accepts an explicit four-worker twenty-active-task topology for real acceptance', () => {
  assert.deepEqual(loadCapacityAcceptanceProfile({
    WORKBENCH_TWENTY_USER_ACCEPTANCE: '1',
    WORKBENCH_ACCEPTANCE_WORKER_COUNT: '4',
    WORKBENCH_ACCEPTANCE_WORKER_CAPACITY: '5'
  }), {
    users: 20, conversationsPerUser: 3, connectionsPerUser: 1, rounds: 3,
    workerCount: 4, workerCapacity: 5, executionSlots: 20, name: 'twenty-user'
  });
});

test('rejects accidental truthy spellings for the capacity acceptance gate', () => {
  assert.throws(() => loadCapacityAcceptanceProfile({ WORKBENCH_TWENTY_USER_ACCEPTANCE: 'true' }), /WORKBENCH_TWENTY_USER_ACCEPTANCE/);
  assert.throws(() => loadCapacityAcceptanceProfile({ WORKBENCH_ACCEPTANCE_WORKER_COUNT: '0' }), /WORKBENCH_ACCEPTANCE_WORKER_COUNT/);
  assert.throws(() => loadCapacityAcceptanceProfile({ WORKBENCH_ACCEPTANCE_WORKER_CAPACITY: 'five' }), /WORKBENCH_ACCEPTANCE_WORKER_CAPACITY/);
  assert.throws(() => loadCapacityAcceptanceProfile({ WORKBENCH_ACCEPTANCE_WORKER_COUNT: '5', WORKBENCH_ACCEPTANCE_WORKER_CAPACITY: '5' }), /20 execution slots/);
});
