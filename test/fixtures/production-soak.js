'use strict';

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} is invalid`);
  return value;
}

function createProductionSoakSchedule({ users, cohortSize, durationMs, intervalMs } = {}) {
  const userCount = positiveInteger(users, 'soak users');
  const cohort = positiveInteger(cohortSize, 'soak cohort size');
  const duration = positiveInteger(durationMs, 'soak duration');
  const interval = positiveInteger(intervalMs, 'soak interval');
  if (cohort > userCount) throw new TypeError('soak cohort size is invalid');
  const cycles = Math.ceil(duration / interval);
  if (cycles * cohort < userCount) throw new TypeError('soak schedule does not cover every user');
  return Object.freeze(Array.from({ length: cycles }, (_, cycleIndex) => Object.freeze({
    offsetMs: cycleIndex * interval,
    userIndexes: Object.freeze(Array.from(
      { length: cohort },
      (_, cohortIndex) => (cycleIndex * cohort + cohortIndex) % userCount
    ))
  })));
}

module.exports = { createProductionSoakSchedule };
