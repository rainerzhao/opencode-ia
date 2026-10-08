'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { setTimeout: delay } = require('node:timers/promises');

function failure(code) { return Object.assign(new Error(code), { code }); }

async function checkPort(port) {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', () => reject(failure('RELEASE_PROCESS_PORT_UNAVAILABLE')));
    probe.listen(port, '127.0.0.1', resolve);
  });
  await new Promise(resolve => probe.close(resolve));
}

// Release packages and environment have already passed the manifest/profile gate.
// Do not inherit the harness's module cache, output streams or working directory.
async function startRelease({ releaseDir, env, port, startupTimeoutMs = 60000, shutdownTimeoutMs = 5000 } = {}) {
  try {
    if (process.platform === 'win32' || !path.isAbsolute(releaseDir) ||
        !Number.isInteger(port) || port < 1 || port > 65535 ||
        !Number.isSafeInteger(startupTimeoutMs) || startupTimeoutMs <= 0 ||
        !Number.isSafeInteger(shutdownTimeoutMs) || shutdownTimeoutMs <= 0 ||
        !env || typeof env !== 'object') throw new Error();
    for (const [file, directory] of [[releaseDir, true], [path.join(releaseDir, 'scripts'), true], [path.join(releaseDir, 'scripts/start-production.js'), false]]) {
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile())) throw new Error();
    }
  } catch { throw failure('RELEASE_PROCESS_INVALID'); }
  await checkPort(port);
  const child = spawn(process.execPath, [path.join(releaseDir, 'scripts/start-production.js')], {
    cwd: releaseDir,
    env: { ...env, WORKBENCH_ROOT: releaseDir, WEB_DIST_DIR: path.join(releaseDir, 'dist/web'), PORT: String(port) },
    detached: true,
    stdio: 'ignore'
  });
  let ended = false;
  child.once('exit', () => { ended = true; });
  child.once('error', () => { ended = true; });
  const groupAlive = () => {
    if (!child.pid) return false;
    try { process.kill(-child.pid, 0); return true; }
    catch (error) {
      if (error.code === 'ESRCH') return false;
      throw failure('RELEASE_PROCESS_CLEANUP_FAILED');
    }
  };
  const signal = value => {
    if (!child.pid) return;
    try { process.kill(-child.pid, value); }
    catch (error) { if (error.code !== 'ESRCH') throw failure('RELEASE_PROCESS_CLEANUP_FAILED'); }
  };
  async function waitForGroup(timeout) {
    const deadline = Date.now() + timeout;
    while (groupAlive() && Date.now() < deadline) await delay(20);
    return !groupAlive();
  }
  let stopping;
  function stop() {
    if (!stopping) stopping = (async () => {
      signal('SIGTERM');
      if (await waitForGroup(shutdownTimeoutMs)) return;
      signal('SIGKILL');
      if (!await waitForGroup(shutdownTimeoutMs)) throw failure('RELEASE_PROCESS_CLEANUP_FAILED');
    })();
    return stopping;
  }
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + startupTimeoutMs;
    while (Date.now() < deadline) {
      if (ended) throw failure('RELEASE_PROCESS_EXITED');
      try {
        const response = await fetch(baseUrl + '/healthz', {
          redirect: 'error', signal: AbortSignal.timeout(Math.max(1, Math.min(300, deadline - Date.now())))
        });
        const health = await response.json();
        if (response.ok && health.status === 'healthy' && health.database === 'healthy' && health.gateway === 'healthy' && !ended) {
          return { baseUrl, pid: child.pid, stop };
        }
      } catch { /* Only the safe timeout/exit classification leaves this boundary. */ }
      await delay(Math.max(1, Math.min(50, deadline - Date.now())));
    }
    throw failure(ended ? 'RELEASE_PROCESS_EXITED' : 'RELEASE_PROCESS_TIMEOUT');
  } catch (error) {
    await stop();
    throw error;
  }
}

module.exports = { startRelease };
