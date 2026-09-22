'use strict';

function positiveIntegerOverride(env, name, fallback) {
  const value = env[name];
  if (value === undefined || value === '') return fallback;
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${name} must be a positive integer`);
  return Number(value);
}

function loadCapacityAcceptanceProfile(env = process.env) {
  const gate = env.WORKBENCH_TWENTY_USER_ACCEPTANCE;
  if (gate !== undefined && gate !== '0' && gate !== '1') throw new Error('WORKBENCH_TWENTY_USER_ACCEPTANCE must be 0 or 1');
  const workerCount = positiveIntegerOverride(env, 'WORKBENCH_ACCEPTANCE_WORKER_COUNT', 1);
  const workerCapacity = positiveIntegerOverride(env, 'WORKBENCH_ACCEPTANCE_WORKER_CAPACITY', 5);
  const executionSlots = workerCount * workerCapacity;
  if (executionSlots > 20) throw new Error('WORKBENCH_ACCEPTANCE topology exceeds 20 execution slots');
  const shared = { conversationsPerUser: 3, connectionsPerUser: 1, rounds: 3, workerCount, workerCapacity, executionSlots };
  if (gate === '1') return Object.freeze({ users: 20, ...shared, name: 'twenty-user' });
  return Object.freeze({ users: 5, ...shared, name: 'five-user' });
}

module.exports = { loadCapacityAcceptanceProfile };
