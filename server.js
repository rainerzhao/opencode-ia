'use strict';

const { loadConfig } = require('./src/config');
const { createPromptRunner } = require('./src/opencode/run-prompt');
const { createWorkbenchServer } = require('./src/create-workbench-server');

const config = loadConfig({ env: process.env, projectDir: __dirname });
const promptRunner = createPromptRunner({
  command: config.opencodeCmd,
  baseArgs: [],
  cwd: config.opencodeCwd,
  env: process.env,
  timeoutMs: config.opencodeTimeoutMs,
  maxOutputBytes: config.opencodeMaxOutputBytes
});
const workbench = createWorkbenchServer({ config, promptRunner, logger: console });

workbench.start().then((address) => {
  console.log(`团队 AI 工作台已启动: http://localhost:${address.port}`);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
