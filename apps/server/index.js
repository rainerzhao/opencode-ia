'use strict';

const path = require('node:path');
const { loadConfig } = require('../../src/config');
const { createPromptRunner } = require('../../src/opencode/run-prompt');
const { createWorkbenchServer } = require('../../src/create-workbench-server');

function createProductionWorkbench({ env = process.env, logger = console, projectDir = path.resolve(__dirname, '../..') } = {}) {
  const config = loadConfig({ env, projectDir });
  const promptRunner = createPromptRunner({
    command: config.opencodeCmd,
    baseArgs: [],
    cwd: config.opencodeCwd,
    env,
    timeoutMs: config.opencodeTimeoutMs,
    maxOutputBytes: config.opencodeMaxOutputBytes
  });
  return createWorkbenchServer({ config, promptRunner, logger });
}

async function startProduction(options) {
  const logger = options?.logger || console;
  const workbench = createProductionWorkbench(options);
  const address = await workbench.start();
  logger.log(`团队 AI 工作台已启动: http://localhost:${address.port}`);
  return workbench;
}

module.exports = { createProductionWorkbench, startProduction };
