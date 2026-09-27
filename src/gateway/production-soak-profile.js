'use strict';

const { loadProductionCapacityProfile } = require('./production-capacity-profile');

function profileError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function boundedInteger(value, { min, max, code, message }) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw profileError(code, message);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw profileError(code, message);
  return parsed;
}

function loadProductionSoakProfile({ env = process.env, platform = process.platform } = {}) {
  if (env.WORKBENCH_PRODUCTION_SOAK_ACCEPTANCE !== '1') {
    throw profileError('PRODUCTION_SOAK_GATE_REQUIRED', 'Production soak acceptance requires the exact explicit gate');
  }
  if (env.WORKBENCH_PRODUCTION_RECOVERY_ACCEPTANCE !== '1') {
    throw profileError(
      'PRODUCTION_SOAK_RECOVERY_GATE_REQUIRED',
      'Production soak acceptance requires the recovery acceptance gate'
    );
  }
  const capacity = loadProductionCapacityProfile({ env, platform });
  const durationMinutes = boundedInteger(env.WORKBENCH_PRODUCTION_SOAK_MINUTES, {
    min: 60,
    max: 1440,
    code: 'PRODUCTION_SOAK_DURATION_INVALID',
    message: 'Production soak duration must be an explicit bounded integer'
  });
  const intervalSeconds = boundedInteger(env.WORKBENCH_PRODUCTION_SOAK_INTERVAL_SECONDS, {
    min: 60,
    max: 3600,
    code: 'PRODUCTION_SOAK_INTERVAL_INVALID',
    message: 'Production soak interval must be an explicit bounded integer'
  });
  const durationMs = durationMinutes * 60_000;
  const intervalMs = intervalSeconds * 1_000;
  const cohortSize = 5;
  const cycles = Math.ceil(durationMs / intervalMs);
  if (cycles * cohortSize < capacity.users) {
    throw profileError(
      'PRODUCTION_SOAK_COVERAGE_INVALID',
      'Production soak timing must cover every acceptance user'
    );
  }
  return Object.freeze({
    name: 'production-mysql-twenty-user-soak',
    durationMinutes,
    intervalSeconds,
    durationMs,
    intervalMs,
    users: capacity.users,
    cohortSize,
    cycles
  });
}

module.exports = { loadProductionSoakProfile };
