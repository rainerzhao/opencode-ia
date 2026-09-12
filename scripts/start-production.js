#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { startProduction } = require('../apps/server');
const { validateProductionConfig } = require('./check-production-config');
const { validateOpenCodeProviderConfig } = require('./check-opencode-provider');

async function startCheckedProduction({
  env = process.env,
  projectDir = path.resolve(__dirname, '..'),
  uid = process.getuid?.(),
  logger = console,
  start = startProduction
} = {}) {
  const production = validateProductionConfig({ env, projectDir, uid });
  const provider = validateOpenCodeProviderConfig({ env, uid });
  logger.log(`生产启动门禁通过：${production.database}、非 root、${provider.providers.length} 个 OpenCode Provider`);
  return start({ env, projectDir, logger });
}

if (require.main === module) {
  startCheckedProduction().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { startCheckedProduction };
