#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadConfig } = require('../src/config');
const { createPromptRunner } = require('../src/opencode/run-prompt');
const { createWorkbenchServer } = require('../src/create-workbench-server');
const { openDatabase } = require('../src/db/open-database');
const { migrateDatabase } = require('../src/db/migrate');
const { bootstrapAdmin } = require('../src/bootstrap/bootstrap-admin');

const sourceRoot = path.resolve(__dirname, '..');
const portArg = process.argv.find((arg) => arg.startsWith('--port='));
const port = portArg ? Number(portArg.slice('--port='.length)) : Number(process.env.DEMO_PORT || 4317);

if (!Number.isInteger(port) || port < 0 || port > 65535) {
  process.stderr.write('Demo port must be an integer from 0 to 65535\n');
  process.exitCode = 1;
  process.exit();
}

const demoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-workbench-demo-'));
const demoHome = path.join(demoRoot, 'home');
const demoConfigDir = path.join(demoHome, '.config', 'opencode');

fs.cpSync(path.join(sourceRoot, 'public'), path.join(demoRoot, 'public'), { recursive: true });
fs.cpSync(path.join(sourceRoot, 'knowledge'), path.join(demoRoot, 'knowledge'), { recursive: true });
fs.mkdirSync(path.join(demoRoot, 'solutions'), { recursive: true });
fs.mkdirSync(path.join(demoRoot, '.opencode', 'skills'), { recursive: true });
fs.mkdirSync(demoConfigDir, { recursive: true });
fs.writeFileSync(
  path.join(demoConfigDir, 'opencode.jsonc'),
  JSON.stringify({ model: 'demo/fake-opencode' }, null, 2),
  'utf8'
);

process.env.HOME = demoHome;
const env = {
  ...process.env,
  WORKBENCH_ROOT: demoRoot,
  OPENCODE_CWD: demoRoot,
  OPENCODE_CMD: path.join(sourceRoot, 'scripts', 'demo-opencode.js'),
  OPENCODE_TIMEOUT_MS: '3000',
  KNOWLEDGE_FETCH_ALLOWED_HOSTS: ''
};
const config = loadConfig({ env, projectDir: demoRoot });
let workbench;
let shuttingDown = false;

async function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    if (workbench) await workbench.stop();
  } catch (error) {
    process.stderr.write(`Demo shutdown warning: ${error.code || 'UNKNOWN'}\n`);
    exitCode = 1;
  } finally {
    fs.rmSync(demoRoot, { recursive: true, force: true });
    process.exitCode = exitCode;
  }
}

process.once('SIGINT', () => void shutdown(0));
process.once('SIGTERM', () => void shutdown(0));
process.once('SIGHUP', () => void shutdown(0));

async function main() {
  const username = 'demo-admin';
  const password = `Demo-${crypto.randomBytes(18).toString('base64url')}!9a`;
  const bootstrapDb = openDatabase({ filename: config.databasePath });
  try {
    migrateDatabase(bootstrapDb);
    await bootstrapAdmin({
      db: bootstrapDb,
      username,
      displayName: 'Demo Administrator',
      password
    });
  } finally {
    bootstrapDb.close();
  }

  const promptRunner = createPromptRunner({
    command: env.OPENCODE_CMD,
    baseArgs: [],
    cwd: config.opencodeCwd,
    env,
    timeoutMs: config.opencodeTimeoutMs,
    maxOutputBytes: config.opencodeMaxOutputBytes
  });
  workbench = createWorkbenchServer({ config, promptRunner, logger: console });
  const address = await workbench.start(port, '127.0.0.1');
  const url = `http://127.0.0.1:${address.port}`;
  console.log('演示模式：AI 内容为本地模拟回复，不调用真实模型或 API Key。');
  console.log(`打开浏览器：${url}`);
  console.log(`临时演示账号：${username}（密码仅在本次启动输出中有效）`);
  console.log(`DEMO_READY ${JSON.stringify({
    mode: 'demo',
    host: address.address,
    url,
    root: demoRoot,
    credentials: { username, password }
  })}`);
}

main().catch(async (error) => {
  process.stderr.write(`Demo failed to start: ${error.code || 'UNKNOWN'}\n`);
  await shutdown(1);
});
