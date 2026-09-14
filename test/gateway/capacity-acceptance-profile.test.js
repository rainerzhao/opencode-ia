'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCapacityAcceptanceProfile } = require('../../src/gateway/capacity-acceptance-profile');

test('uses the fast five-user profile unless a capacity acceptance is explicitly enabled', () => {
  assert.deepEqual(loadCapacityAcceptanceProfile({}), { users: 5, conversationsPerUser: 3, connectionsPerUser: 1, rounds: 3, executionSlots: 5, name: 'five-user' });
});

test('uses a bounded twenty-user profile with queued execution slots', () => {
  assert.deepEqual(loadCapacityAcceptanceProfile({ WORKBENCH_TWENTY_USER_ACCEPTANCE: '1' }), { users: 20, conversationsPerUser: 3, connectionsPerUser: 1, rounds: 3, executionSlots: 5, name: 'twenty-user' });
});

test('rejects accidental truthy spellings for the capacity acceptance gate', () => {
  assert.throws(() => loadCapacityAcceptanceProfile({ WORKBENCH_TWENTY_USER_ACCEPTANCE: 'true' }), /WORKBENCH_TWENTY_USER_ACCEPTANCE/);
});
