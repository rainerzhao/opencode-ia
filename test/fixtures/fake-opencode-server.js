'use strict';

const http = require('node:http');

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : null); } catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

function createFakeOpenCodeServer({
  username = 'opencode',
  password = 'worker-secret',
  version = '1.18.25',
  healthDelayMs = 0,
  healthBodyDelayMs = 0
} = {}) {
  const requests = [];
  const expectedAuth = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  let server;
  let sessionCounter = 0;

  async function handler(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readJson(req) : null;
    requests.push({
      method: req.method,
      pathname: url.pathname,
      query: Object.fromEntries(url.searchParams),
      authorization: req.headers.authorization || null,
      body
    });

    if (req.headers.authorization !== expectedAuth) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end('{"error":"unauthorized"}');
      return;
    }

    if (url.pathname === '/global/health' && req.method === 'GET') {
      if (healthDelayMs) await new Promise((resolve) => setTimeout(resolve, healthDelayMs));
      res.writeHead(200, { 'content-type': 'application/json' });
      if (healthBodyDelayMs) res.flushHeaders();
      if (healthBodyDelayMs) await new Promise((resolve) => setTimeout(resolve, healthBodyDelayMs));
      res.end(JSON.stringify({ healthy: true, version }));
      return;
    }

    if (url.pathname === '/session' && req.method === 'POST') {
      const id = `ses_fake_${++sessionCounter}`;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id,
        slug: `fake-${sessionCounter}`,
        projectID: 'project-fake',
        directory: url.searchParams.get('directory') || '/workspace',
        title: body?.title || 'New session',
        version,
        time: { created: 1788483600000, updated: 1788483600000 },
        agent: body?.agent || 'build',
        model: body?.model || { id: 'deepseek-chat', providerID: 'deepseek' },
        permission: body?.permission || []
      }));
      return;
    }

    if (/^\/session\/[^/]+$/.test(url.pathname) && req.method === 'GET') {
      const id = decodeURIComponent(url.pathname.split('/').at(-1));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id,
        slug: 'fake-existing',
        projectID: 'project-fake',
        directory: url.searchParams.get('directory') || '/workspace',
        title: 'Existing session',
        version,
        time: { created: 1788483600000, updated: 1788483600000 }
      }));
      return;
    }

    if (/^\/session\/[^/]+\/message$/.test(url.pathname) && req.method === 'POST') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        info: {
          id: 'msg_fake_1',
          sessionID: decodeURIComponent(url.pathname.split('/')[2]),
          role: 'assistant',
          time: { created: 1788483600000, completed: 1788483600100 },
          parentID: 'msg_user_1',
          modelID: 'deepseek-chat',
          providerID: 'deepseek',
          mode: 'build',
          agent: 'build',
          path: { cwd: '/workspace', root: '/workspace' },
          cost: 0,
          tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
          finish: 'stop'
        },
        parts: [{
          id: 'part_fake_1',
          sessionID: decodeURIComponent(url.pathname.split('/')[2]),
          messageID: 'msg_fake_1',
          type: 'text',
          text: 'fake answer'
        }]
      }));
      return;
    }

    if (/^\/session\/[^/]+\/abort$/.test(url.pathname) && req.method === 'POST') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('true');
      return;
    }

    if (url.pathname === '/event' && req.method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache'
      });
      res.write(': connected\n\n');
      res.write('data: {"type":"message.part.updated","properties":{"part":{"type":"text","text":"fake"}}}\n\n');
      res.end('data: {"type":"session.idle","properties":{"sessionID":"ses_fake_1"}}\n\n');
      return;
    }

    if (url.pathname === '/fail') {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('internal provider secret must stay private');
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{"error":"not found"}');
  }

  async function start() {
    server = http.createServer((req, res) => {
      handler(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
        res.end('{"error":"fixture failure"}');
      });
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    return `http://127.0.0.1:${server.address().port}`;
  }

  async function stop() {
    if (!server) return;
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }

  return { requests, start, stop };
}

module.exports = { createFakeOpenCodeServer };
