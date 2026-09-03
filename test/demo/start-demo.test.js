'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

const projectDir = path.resolve(__dirname, '../..');
const demoScript = path.join(projectDir, 'scripts/start-demo.js');

function waitForReady(child, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`demo did not become ready; stdout=${stdout}; stderr=${stderr}`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeout);
      child.stdout.off('data', onStdout);
      child.stderr.off('data', onStderr);
      child.off('exit', onExit);
    }

    function onStdout(chunk) {
      stdout += chunk.toString();
      for (const line of stdout.split('\n')) {
        if (!line.startsWith('DEMO_READY ')) continue;
        cleanup();
        resolve(JSON.parse(line.slice('DEMO_READY '.length)));
      }
    }

    function onStderr(chunk) {
      stderr += chunk.toString();
    }

    function onExit(code) {
      cleanup();
      reject(new Error(`demo exited before ready with code ${code}; stderr=${stderr}`));
    }

    child.stdout.on('data', onStdout);
    child.stderr.on('data', onStderr);
    child.once('exit', onExit);
  });
}

function waitForJson(ws, predicate, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('timed out waiting for demo WebSocket message'));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeout);
      ws.off('message', onMessage);
      ws.off('error', onError);
    }

    function onMessage(data) {
      const message = JSON.parse(data.toString());
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    ws.on('message', onMessage);
    ws.on('error', onError);
  });
}

function waitForExit(child, timeoutMs = 2000) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('demo did not stop')), timeoutMs);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
}

function getSetCookies(response) {
  return typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
}

async function loginDemo(ready) {
  const response = await fetch(`${ready.url}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(ready.credentials)
  });
  assert.equal(response.status, 200);
  const cookie = getSetCookies(response)
    .map((header) => header.split(';', 1)[0])
    .join('; ');
  return { cookie };
}

test('starts an isolated full-stack demo and removes its temporary data on shutdown', async (t) => {
  const child = spawn(process.execPath, [demoScript, '--port=0'], {
    cwd: projectDir,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  });

  const ready = await waitForReady(child);
  assert.equal(ready.mode, 'demo');
  assert.equal(ready.host, '127.0.0.1');
  assert.match(ready.root, new RegExp(`^${os.tmpdir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.notEqual(path.resolve(ready.root), projectDir);
  assert.equal(ready.credentials.username, 'demo-admin');
  assert.match(ready.credentials.password, /^Demo-[A-Za-z0-9_-]{24}!9a$/);
  const session = await loginDemo(ready);

  const configResponse = await fetch(`${ready.url}/api/config`, {
    headers: { cookie: session.cookie }
  });
  assert.equal(configResponse.status, 200);
  assert.equal((await configResponse.json()).model, 'demo/fake-opencode');

  const treeResponse = await fetch(`${ready.url}/api/knowledge/tree`, {
    headers: { cookie: session.cookie }
  });
  assert.equal(treeResponse.status, 200);
  const tree = await treeResponse.json();
  const documentCount = tree.reduce((count, item) => count + (item.children?.length || 0), 0);
  assert.equal(documentCount, 3);

  const ws = new WebSocket(ready.url.replace('http:', 'ws:'), {
    headers: { cookie: session.cookie }
  });
  await waitForJson(ws, (message) => message.type === 'connected');
  ws.send(JSON.stringify({ type: 'input', data: 'demo round trip' }));
  const response = await waitForJson(ws, (message) => message.type === 'response');
  assert.equal(response.data, '【Demo 模拟回复】demo round trip');
  ws.close();

  child.kill('SIGTERM');
  assert.equal(await waitForExit(child), 0);
  assert.equal(fs.existsSync(ready.root), false);
});

test('removes temporary data when the launching terminal hangs up', async (t) => {
  const child = spawn(process.execPath, [demoScript, '--port=0'], {
    cwd: projectDir,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let ready;
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
    if (ready?.root) fs.rmSync(ready.root, { recursive: true, force: true });
  });

  ready = await waitForReady(child);
  child.kill('SIGHUP');

  assert.equal(await waitForExit(child), 0);
  assert.equal(fs.existsSync(ready.root), false);
});
