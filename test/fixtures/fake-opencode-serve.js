#!/usr/bin/env node
'use strict';

const http = require('node:http');

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

if (!process.argv.includes('serve')) process.exit(64);
const hostname = argument('--hostname');
const port = Number(argument('--port'));
const password = process.env.OPENCODE_SERVER_PASSWORD;
const username = process.env.OPENCODE_SERVER_USERNAME || 'opencode';
if (hostname !== '127.0.0.1' || !Number.isInteger(port) || port < 1 || !password) process.exit(65);

const expectedAuthorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
const version = process.env.FAKE_OPENCODE_VERSION || '1.18.25';
const startDelayMs = Number(process.env.FAKE_OPENCODE_START_DELAY_MS || 0);
const exitAfterMs = Number(process.env.FAKE_OPENCODE_EXIT_AFTER_MS || 0);
const ignoreTerm = process.env.FAKE_OPENCODE_IGNORE_TERM === '1';

const server = http.createServer((req, res) => {
  if (req.headers.authorization !== expectedAuthorization) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end('{"error":"unauthorized"}');
    return;
  }
  if (req.url === '/global/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ healthy: true, version }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end('{"error":"not found"}');
});

function shutdown() {
  server.close(() => process.exit(0));
}

if (!ignoreTerm) process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

setTimeout(() => {
  server.listen(port, hostname, () => {
    if (exitAfterMs > 0) setTimeout(() => process.exit(71), exitAfterMs).unref();
  });
}, startDelayMs);
