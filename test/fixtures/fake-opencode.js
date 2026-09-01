#!/usr/bin/env node

'use strict';

const fs = require('node:fs');

const args = process.argv.slice(2);
const runIndex = args.indexOf('run');
const messageIndex = args.findIndex((arg, index) => (
  arg === '--format' && args[index + 1] === 'json'
));
const message = messageIndex === -1 ? '' : (args[messageIndex + 2] || '');
const markerArg = args.find((arg) => arg.startsWith('--term-marker='));
const markerPath = markerArg ? markerArg.slice('--term-marker='.length) : null;

process.on('SIGTERM', () => {
  if (markerPath) fs.writeFileSync(markerPath, 'terminated', 'utf8');
  process.exit(143);
});

if (runIndex === -1 || args[runIndex + 1] !== '--format' || args[runIndex + 2] !== 'json') {
  process.stderr.write('invalid fake opencode arguments\n');
  process.exitCode = 2;
} else if (message === '__TEST_DELAY__') {
  setInterval(() => {}, 1000);
} else if (message === '__TEST_OVERSIZE__') {
  process.stdout.write('x'.repeat(160));
  process.stderr.write('y'.repeat(160));
} else if (message === '__TEST_NONZERO__') {
  process.stderr.write('controlled fixture failure\n');
  process.exitCode = 7;
} else if (message === '__TEST_EMPTY__') {
  process.stdout.write(`${JSON.stringify({ type: 'status', status: 'complete' })}\n`);
} else {
  process.stdout.write(`${JSON.stringify({ type: 'text', part: { text: message } })}\n`);
}
