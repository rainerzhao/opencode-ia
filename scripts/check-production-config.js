#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('../src/config');
const { parseMySqlUrl } = require('../src/db/mysql-database');

function configError(message) {
  const error = new Error(message);
  error.code = 'PRODUCTION_CONFIG_INVALID';
  return error;
}

function validateProductionConfig({ env = process.env, projectDir = process.cwd(), uid = process.getuid?.(), commandExists } = {}) {
  if (env.NODE_ENV !== 'production') throw configError('NODE_ENV must be production');
  if (uid === 0) throw configError('production service must not run as root');
  if (!env.WORKBENCH_DATABASE_URL) throw configError('WORKBENCH_DATABASE_URL is required; SQLite fallback is disabled');
  if (env.DATABASE_PATH) throw configError('DATABASE_PATH must not be set with the MySQL production composition');
  if (env.COOKIE_SECURE !== 'true') throw configError('COOKIE_SECURE must be true in production');
  const config = loadConfig({ env, projectDir });
  try { parseMySqlUrl(config.workbenchDatabaseUrl); } catch { throw configError('WORKBENCH_DATABASE_URL is invalid'); }
  if (!path.isAbsolute(config.opencodeCmd)) throw configError('OPENCODE_CMD must be an absolute executable path');
  const exists = commandExists === undefined
    ? (() => {
      try {
        const stat = fs.statSync(config.opencodeCmd);
        return stat.isFile() && (stat.mode & 0o111) !== 0;
      } catch { return false; }
    })()
    : commandExists;
  if (!exists) throw configError('OPENCODE_CMD must point to an executable');
  if (config.gatewayGlobalRunning > config.opencodeWorkerCount * config.opencodeWorkerCapacity) {
    throw configError('GATEWAY_GLOBAL_RUNNING exceeds worker capacity');
  }
  return {
    database: 'mysql',
    cookieSecure: config.cookieSecure,
    runtime: config.opencodeCmd,
    uid
  };
}

function main() {
  const result = validateProductionConfig();
  console.log(`生产配置检查通过：MySQL、Secure Cookie、OpenCode Runtime、非 root（uid ${result.uid}）`);
  return result;
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { validateProductionConfig, main };
