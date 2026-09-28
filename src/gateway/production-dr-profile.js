'use strict';

const { parseMySqlUrl } = require('../db/mysql-database');
const { loadProductionSoakProfile } = require('./production-soak-profile');

function profileError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function loadProductionDrProfile({ env = process.env, platform = process.platform } = {}) {
  if (env.WORKBENCH_PRODUCTION_DR_ACCEPTANCE !== '1') {
    throw profileError('PRODUCTION_DR_GATE_REQUIRED', 'Production disaster recovery requires the exact explicit gate');
  }
  loadProductionSoakProfile({ env, platform });
  const targetCaFile = env.WORKBENCH_RECOVERY_MYSQL_SSL_CA_FILE || null;
  let source;
  let target;
  try {
    source = parseMySqlUrl(env.WORKBENCH_DATABASE_URL, {
      sslCaFile: env.MYSQL_SSL_CA_FILE || null
    });
    target = parseMySqlUrl(env.WORKBENCH_RECOVERY_DATABASE_URL, {
      sslCaFile: targetCaFile
    });
  } catch {
    throw profileError(
      'PRODUCTION_DR_TARGET_REQUIRED',
      'A separate TLS MySQL recovery acceptance database is required'
    );
  }
  const sourceIdentity = `${source.host}:${source.port}/${source.database}`;
  const targetIdentity = `${target.host}:${target.port}/${target.database}`;
  if (sourceIdentity === targetIdentity) {
    throw profileError('PRODUCTION_DR_TARGET_CONFLICT', 'Source and recovery databases must be distinct');
  }
  const targetName = target.database.toLowerCase();
  if (!target.ssl || !targetName.includes('acceptance') || !/(recovery|restore)/.test(targetName)) {
    throw profileError(
      'PRODUCTION_DR_TARGET_REQUIRED',
      'A separate TLS MySQL recovery acceptance database is required'
    );
  }
  return Object.freeze({
    name: 'production-mysql-disaster-recovery',
    source: 'mysql-dedicated-acceptance',
    target: 'mysql-dedicated-recovery',
    targetCaFileConfigured: Boolean(targetCaFile)
  });
}

module.exports = { loadProductionDrProfile };
