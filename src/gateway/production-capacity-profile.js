'use strict';

const { parseMySqlUrl } = require('../db/mysql-database');

function profileError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function loadProductionCapacityProfile({ env = process.env, platform = process.platform } = {}) {
  if (env.WORKBENCH_PRODUCTION_CAPACITY_ACCEPTANCE !== '1') {
    throw profileError(
      'PRODUCTION_CAPACITY_GATE_REQUIRED',
      'Production capacity acceptance requires the exact explicit gate'
    );
  }
  if (platform !== 'linux') {
    throw profileError(
      'PRODUCTION_CAPACITY_LINUX_REQUIRED',
      'Production capacity acceptance must run on Linux'
    );
  }

  let connection;
  try {
    connection = parseMySqlUrl(env.WORKBENCH_DATABASE_URL, {
      sslCaFile: env.MYSQL_SSL_CA_FILE || null
    });
  } catch {
    throw profileError(
      'PRODUCTION_CAPACITY_DATABASE_REQUIRED',
      'A dedicated MySQL acceptance database is required'
    );
  }
  if (!connection.ssl || !/acceptance/i.test(connection.database)) {
    throw profileError(
      'PRODUCTION_CAPACITY_DATABASE_REQUIRED',
      'A dedicated MySQL acceptance database is required'
    );
  }

  const expected = Object.freeze({
    OPENCODE_WORKER_COUNT: '4',
    OPENCODE_WORKER_CAPACITY: '5',
    GATEWAY_GLOBAL_RUNNING: '20',
    GATEWAY_USER_RUNNING: '1',
    MAX_SESSIONS: '20'
  });
  if (Object.entries(expected).some(([name, value]) => env[name] !== value)) {
    throw profileError(
      'PRODUCTION_CAPACITY_TOPOLOGY_INVALID',
      'Production capacity acceptance requires the fixed 4x5 and twenty-session topology'
    );
  }

  return Object.freeze({
    name: 'production-mysql-twenty-user',
    database: 'mysql-dedicated-acceptance',
    users: 20,
    connections: 20,
    conversationsPerUser: 3,
    conversations: 60,
    rounds: 3,
    tasks: 180,
    workerCount: 4,
    workerCapacity: 5,
    executionSlots: 20,
    userRunning: 1
  });
}

module.exports = { loadProductionCapacityProfile };
