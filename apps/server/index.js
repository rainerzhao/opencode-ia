'use strict';

const path = require('node:path');
const { loadConfig } = require('../../src/config');
const { createPromptRunner } = require('../../src/opencode/run-prompt');
const { createWorkbenchServer } = require('../../src/create-workbench-server');
const { createFairQueue } = require('../../src/gateway/fair-queue');
const { createGatewayService } = require('../../src/gateway/gateway-service');
const { createWorkerPool } = require('../../src/gateway/worker-pool');
const { createWorkerProcess } = require('../../src/gateway/worker-process');

function createProductionWorkbench({
  env = process.env,
  logger = console,
  projectDir = path.resolve(__dirname, '../..'),
  workerFactory
} = {}) {
  const config = loadConfig({ env, projectDir });
  const promptRunner = createPromptRunner({
    command: config.opencodeCmd,
    baseArgs: [],
    cwd: config.opencodeCwd,
    env,
    timeoutMs: config.opencodeTimeoutMs,
    maxOutputBytes: config.opencodeMaxOutputBytes
  });
  const createWorker = workerFactory || (({ index, onExit }) => createWorkerProcess({
    command: config.opencodeCmd,
    cwd: config.opencodeCwd,
    env,
    hostname: '127.0.0.1',
    port: config.opencodeWorkerBasePort + index,
    username: config.opencodeWorkerUsername,
    expectedVersion: config.opencodeVerifiedVersion,
    startupTimeoutMs: config.opencodeWorkerStartupTimeoutMs,
    healthIntervalMs: config.opencodeWorkerReadinessIntervalMs,
    stopGraceMs: config.opencodeWorkerStopGraceMs,
    killGraceMs: config.opencodeWorkerKillGraceMs,
    logger,
    onExit
  }));
  let gatewayService;
  const server = createWorkbenchServer({
    config,
    promptRunner,
    logger,
    gatewayServiceFactory({ store }) {
      const queue = createFairQueue({ maxQueuedPerUser: config.gatewayUserQueued });
      const pool = createWorkerPool({
        workerCount: config.opencodeWorkerCount,
        workerFactory: createWorker,
        heartbeatMs: config.opencodeWorkerHeartbeatMs,
        heartbeatTimeoutMs: config.opencodeWorkerHeartbeatTimeoutMs
      });
      gatewayService = createGatewayService({
        store,
        pool,
        queue,
        workspaceRoot: config.gatewayWorkspaceRoot,
        limits: {
          globalRunning: config.gatewayGlobalRunning,
          userRunning: config.gatewayUserRunning,
          jobTimeoutMs: config.opencodeTimeoutMs
        },
        logger
      });
      return gatewayService;
    }
  });

  return {
    ...server,
    async start(...args) {
      await gatewayService.start();
      try {
        return await server.start(...args);
      } catch (error) {
        await gatewayService.stop().catch(() => {});
        throw error;
      }
    },
    async stop() {
      let gatewayError;
      try {
        await gatewayService.stop();
      } catch (error) {
        gatewayError = error;
      }
      await server.stop();
      if (gatewayError) throw gatewayError;
    }
  };
}

async function startProduction(options) {
  const logger = options?.logger || console;
  const workbench = createProductionWorkbench(options);
  const address = await workbench.start();
  logger.log(`团队 AI 工作台已启动: http://localhost:${address.port}`);
  return workbench;
}

module.exports = { createProductionWorkbench, startProduction };
