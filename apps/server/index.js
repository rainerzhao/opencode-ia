'use strict';

const path = require('node:path');
const { loadConfig } = require('../../src/config');
const { createPromptRunner } = require('../../src/opencode/run-prompt');
const { createWorkbenchServer } = require('../../src/create-workbench-server');
const { createMySqlDatabase } = require('../../src/db/mysql-database');
const { migrateMySqlDatabase } = require('../../src/db/mysql-migrate');
const { createMySqlAuthService } = require('../../src/auth/mysql-auth-service');
const { createMySqlAuditStore } = require('../../src/audit/mysql-audit-store');
const { createRequestAuditor } = require('../../src/audit/request-audit');
const { createMySqlGatewayStore } = require('../../src/gateway/mysql-gateway-store');
const { createMySqlContentStore } = require('../../src/content/mysql-content-store');
const { createMySqlSkillStore } = require('../../src/skills/mysql-skill-store');
const { createLoginLimiter } = require('../../src/auth/login-limiter');
const { createFairQueue } = require('../../src/gateway/fair-queue');
const { createGatewayService } = require('../../src/gateway/gateway-service');
const { createWorkerPool } = require('../../src/gateway/worker-pool');
const { createWorkerProcess } = require('../../src/gateway/worker-process');

function createWorkerFactory({ config, env, logger, workerFactory }) {
  return workerFactory || (({ index, onExit }) => createWorkerProcess({
    command: config.opencodeCmd,
    cwd: config.opencodeCwd,
    env,
    hostname: '127.0.0.1',
    port: config.opencodeWorkerBasePort + index,
    username: config.opencodeWorkerUsername,
    expectedVersion: config.opencodeVerifiedVersion,
    startupTimeoutMs: config.opencodeWorkerStartupTimeoutMs,
    promptTimeoutMs: config.opencodeTimeoutMs,
    healthIntervalMs: config.opencodeWorkerReadinessIntervalMs,
    stopGraceMs: config.opencodeWorkerStopGraceMs,
    killGraceMs: config.opencodeWorkerKillGraceMs,
    logger,
    onExit
  }));
}

function createGatewayServiceFactory({ config, logger, createWorker }) {
  return ({ store, workspacePreparer }) => {
    const queue = createFairQueue({ maxQueuedPerUser: config.gatewayUserQueued });
    const pool = createWorkerPool({
      workerCount: config.opencodeWorkerCount,
      workerCapacity: config.opencodeWorkerCapacity,
      workerFactory: createWorker,
      heartbeatMs: config.opencodeWorkerHeartbeatMs,
      heartbeatTimeoutMs: config.opencodeWorkerHeartbeatTimeoutMs,
      heartbeatFailureThreshold: config.opencodeWorkerHeartbeatFailures
    });
    return createGatewayService({
      store,
      pool,
      queue,
      workspaceRoot: config.gatewayWorkspaceRoot,
      workspacePreparer,
      limits: {
        globalRunning: config.gatewayGlobalRunning,
        userRunning: config.gatewayUserRunning,
        jobTimeoutMs: config.opencodeTimeoutMs
      },
      logger
    });
  };
}

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
  const createWorker = createWorkerFactory({ config, env, logger, workerFactory });
  let gatewayService;
  const server = createWorkbenchServer({
    config,
    promptRunner,
    logger,
    gatewayServiceFactory({ store, workspacePreparer }) {
      gatewayService = createGatewayServiceFactory({ config, logger, createWorker })({ store, workspacePreparer });
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

async function createMySqlProductionWorkbench({
  env = process.env,
  logger = console,
  projectDir = path.resolve(__dirname, '../..'),
  workerFactory
} = {}) {
  const config = loadConfig({ env, projectDir });
  if (!config.workbenchDatabaseUrl) {
    const error = new Error('WORKBENCH_DATABASE_URL is required for the MySQL production composition');
    error.code = 'MYSQL_URL_REQUIRED';
    throw error;
  }
  const database = await createMySqlDatabase({ url: config.workbenchDatabaseUrl, poolSize: config.mysqlPoolSize });
  try {
    await database.assertCapabilities();
    await migrateMySqlDatabase(database);
    const promptRunner = createPromptRunner({
      command: config.opencodeCmd,
      baseArgs: [],
      cwd: config.opencodeCwd,
      env,
      timeoutMs: config.opencodeTimeoutMs,
      maxOutputBytes: config.opencodeMaxOutputBytes
    });
    const authService = createMySqlAuthService({
      db: database,
      loginLimiter: createLoginLimiter({
        maxFailures: config.loginMaxFailures,
        windowMs: config.loginWindowSeconds * 1000,
        lockMs: config.loginLockSeconds * 1000
      }),
      sessionTtlSeconds: config.sessionTtlSeconds
    });
    const requestAuditor = createRequestAuditor({ auditStore: createMySqlAuditStore(database) });
    const repositories = {
      authService,
      requestAuditor,
      gatewayStore: createMySqlGatewayStore(database),
      skillStore: createMySqlSkillStore(database),
      contentStore: createMySqlContentStore(database)
    };
    let gatewayService;
    const createWorker = createWorkerFactory({ config, env, logger, workerFactory });
    const server = createWorkbenchServer({
      config,
      database,
      promptRunner,
      logger,
      repositories,
      gatewayServiceFactory({ store, workspacePreparer }) {
        gatewayService = createGatewayServiceFactory({ config, logger, createWorker })({ store, workspacePreparer });
        return gatewayService;
      }
    });
    return {
      ...server,
      async start(...args) {
        await gatewayService.start();
        try { return await server.start(...args); }
        catch (error) { await gatewayService.stop().catch(() => {}); await database.close(); throw error; }
      },
      async stop() {
        let gatewayError;
        try { await gatewayService.stop(); } catch (error) { gatewayError = error; }
        await server.stop();
        await database.close();
        if (gatewayError) throw gatewayError;
      }
    };
  } catch (error) {
    await database.close().catch(() => {});
    throw error;
  }
}

async function startProduction(options) {
  const logger = options?.logger || console;
  const config = loadConfig({ env: options?.env || process.env, projectDir: options?.projectDir || path.resolve(__dirname, '../..') });
  const workbench = config.workbenchDatabaseUrl
    ? await createMySqlProductionWorkbench(options)
    : createProductionWorkbench(options);
  const address = await workbench.start();
  logger.log(`团队 AI 工作台已启动: http://localhost:${address.port}`);
  return workbench;
}

module.exports = { createProductionWorkbench, createMySqlProductionWorkbench, startProduction };
