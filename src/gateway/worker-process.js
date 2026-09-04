'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createOpenCodeClient } = require('./opencode-client');

function workerError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function positiveInteger(value, name, { max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new TypeError(`${name} is invalid`);
  }
  return value;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createWorkerProcess({
  command,
  baseArgs = [],
  cwd,
  env = process.env,
  hostname = '127.0.0.1',
  port,
  username = 'opencode',
  password,
  expectedVersion = '1.18.25',
  startupTimeoutMs = 10_000,
  healthIntervalMs = 100,
  stopGraceMs = 2_000,
  killGraceMs = 1_000,
  spawnImpl = spawn,
  fetchImpl = fetch,
  secretFactory = () => crypto.randomBytes(32).toString('base64url'),
  logger = { log() {}, error() {} },
  onExit = () => {}
}) {
  if (typeof command !== 'string' || command.trim() === '') {
    throw new TypeError('OpenCode worker command is required');
  }
  if (!Array.isArray(baseArgs) || baseArgs.some((item) => typeof item !== 'string')) {
    throw new TypeError('OpenCode worker base arguments are invalid');
  }
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) {
    throw new TypeError('OpenCode worker directory must be absolute');
  }
  if (hostname !== '127.0.0.1') {
    throw workerError('OPENCODE_WORKER_UNSAFE_BIND', 'OpenCode worker must bind to 127.0.0.1');
  }
  positiveInteger(port, 'OpenCode worker port', { max: 65535 });
  positiveInteger(startupTimeoutMs, 'OpenCode worker startup timeout');
  positiveInteger(healthIntervalMs, 'OpenCode worker health interval');
  positiveInteger(stopGraceMs, 'OpenCode worker stop grace');
  positiveInteger(killGraceMs, 'OpenCode worker kill grace');
  if (typeof spawnImpl !== 'function' || typeof fetchImpl !== 'function') {
    throw new TypeError('OpenCode worker dependencies are invalid');
  }
  if (typeof secretFactory !== 'function' || typeof onExit !== 'function') {
    throw new TypeError('OpenCode worker callbacks are invalid');
  }

  const runtimePassword = password || secretFactory();
  if (typeof runtimePassword !== 'string' || runtimePassword.length < 16) {
    throw new TypeError('OpenCode worker password is invalid');
  }
  const endpoint = `http://${hostname}:${port}`;
  const client = createOpenCodeClient({
    endpoint,
    username,
    password: runtimePassword,
    expectedVersion,
    requestTimeoutMs: Math.min(startupTimeoutMs, 1_000),
    fetchImpl
  });

  let status = 'stopped';
  let version = null;
  let child = null;
  let expectedExit = false;
  let lastExit = null;
  let exitPromise = null;
  let resolveExit = null;
  let startupFailure = null;
  let startPromise = null;
  let stopPromise = null;

  function snapshot() {
    return {
      status,
      endpoint,
      processId: child?.pid || null,
      version
    };
  }

  function handleExit(code, signal) {
    const exit = { code, signal, expected: expectedExit || status === 'stopping' };
    lastExit = exit;
    child = null;
    if (exit.expected) status = 'stopped';
    else {
      status = 'unhealthy';
      logger.error('OpenCode worker exited unexpectedly');
    }
    resolveExit?.(exit);
    resolveExit = null;
    try { onExit(exit); } catch {}
  }

  async function terminateChild() {
    if (!child) {
      status = 'stopped';
      return snapshot();
    }
    expectedExit = true;
    status = 'stopping';
    const observedExit = exitPromise;
    child.kill('SIGTERM');
    await Promise.race([observedExit, delay(stopGraceMs)]);
    if (child) {
      child.kill('SIGKILL');
      await Promise.race([observedExit, delay(killGraceMs)]);
    }
    if (child) {
      throw workerError('OPENCODE_WORKER_STOP_TIMEOUT', 'OpenCode worker did not stop');
    }
    status = 'stopped';
    return snapshot();
  }

  async function start() {
    if (status === 'healthy' && child) return snapshot();
    if (startPromise) return startPromise;
    if (stopPromise) await stopPromise;

    startPromise = (async () => {
      status = 'starting';
      version = null;
      expectedExit = false;
      lastExit = null;
      startupFailure = null;
      exitPromise = new Promise((resolve) => { resolveExit = resolve; });
      try {
        child = spawnImpl(
          command,
          [
            ...baseArgs,
            'serve',
            '--hostname',
            hostname,
            '--port',
            String(port),
            '--print-logs',
            '--log-level',
            'WARN'
          ],
          {
            cwd,
            env: {
              ...env,
              OPENCODE_SERVER_USERNAME: username,
              OPENCODE_SERVER_PASSWORD: runtimePassword
            },
            shell: false,
            stdio: ['ignore', 'ignore', 'ignore']
          }
        );
      } catch (error) {
        status = 'stopped';
        throw workerError('OPENCODE_WORKER_SPAWN_ERROR', 'OpenCode worker could not be started', error);
      }
      child.once('error', (error) => {
        startupFailure = workerError(
          'OPENCODE_WORKER_SPAWN_ERROR',
          'OpenCode worker could not be started',
          error
        );
      });
      child.once('close', handleExit);

      const deadline = Date.now() + startupTimeoutMs;
      try {
        while (Date.now() < deadline) {
          if (startupFailure) throw startupFailure;
          if (!child) {
            throw workerError('OPENCODE_WORKER_EXITED', 'OpenCode worker exited during startup');
          }
          try {
            const healthResult = await client.health();
            version = healthResult.version;
            status = 'healthy';
            logger.log('OpenCode worker is healthy');
            return snapshot();
          } catch (error) {
            if (error.code === 'OPENCODE_VERSION_MISMATCH') throw error;
          }
          await delay(healthIntervalMs);
        }
        throw workerError('OPENCODE_WORKER_START_TIMEOUT', 'OpenCode worker readiness timed out');
      } catch (error) {
        await terminateChild().catch(() => {});
        throw error;
      }
    })();

    try {
      return await startPromise;
    } finally {
      startPromise = null;
    }
  }

  async function stop() {
    if (stopPromise) return stopPromise;
    stopPromise = terminateChild();
    try {
      return await stopPromise;
    } finally {
      stopPromise = null;
    }
  }

  async function health(options) {
    if (status !== 'healthy' || !child) {
      throw workerError('OPENCODE_WORKER_UNAVAILABLE', 'OpenCode worker is not healthy');
    }
    const result = await client.health(options);
    version = result.version;
    return result;
  }

  function waitForExit() {
    if (lastExit) return Promise.resolve(lastExit);
    if (exitPromise) return exitPromise;
    return Promise.resolve({ code: null, signal: null, expected: true });
  }

  return { client, health, snapshot, start, stop, waitForExit };
}

module.exports = { createWorkerProcess };
