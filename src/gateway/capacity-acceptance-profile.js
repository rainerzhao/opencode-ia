'use strict';

function loadCapacityAcceptanceProfile(env = process.env) {
  const gate = env.WORKBENCH_TWENTY_USER_ACCEPTANCE;
  if (gate !== undefined && gate !== '0' && gate !== '1') throw new Error('WORKBENCH_TWENTY_USER_ACCEPTANCE must be 0 or 1');
  if (gate === '1') return Object.freeze({ users: 20, conversationsPerUser: 3, connectionsPerUser: 1, rounds: 3, executionSlots: 5, name: 'twenty-user' });
  return Object.freeze({ users: 5, conversationsPerUser: 3, connectionsPerUser: 1, rounds: 3, executionSlots: 5, name: 'five-user' });
}

module.exports = { loadCapacityAcceptanceProfile };
