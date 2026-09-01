#!/usr/bin/env node

'use strict';

const fs = require('node:fs');

const args = process.argv.slice(2);
const runIndex = args.indexOf('run');
const hasPromptBoundary = (
  runIndex !== -1 &&
  args[runIndex + 1] === '--format' &&
  args[runIndex + 2] === 'json' &&
  args[runIndex + 3] === '--' &&
  args.length === runIndex + 5
);
const message = hasPromptBoundary ? args[runIndex + 4] : '';
const markerArg = args.find((arg) => arg.startsWith('--term-marker='));
const markerPath = markerArg ? markerArg.slice('--term-marker='.length) : null;
const pidArg = args.find((arg) => arg.startsWith('--pid-marker='));
const pidPath = pidArg ? pidArg.slice('--pid-marker='.length) : null;

process.on('SIGTERM', () => {
  if (markerPath) fs.writeFileSync(markerPath, 'terminated', 'utf8');
  if (message === '__TEST_IGNORE_SIGTERM__') return;
  process.exit(143);
});

if (!hasPromptBoundary) {
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
} else if (message === '__TEST_IGNORE_SIGTERM__') {
  if (pidPath) fs.writeFileSync(pidPath, String(process.pid), 'utf8');
  setInterval(() => {}, 1000);
} else if (message === '__TEST_CHUNKED_UTF8__') {
  const output = Buffer.from(`${JSON.stringify({
    type: 'text',
    part: { text: '分块🙂完成' }
  })}\n`, 'utf8');
  const emojiStart = output.indexOf(Buffer.from('🙂', 'utf8'));
  const splitInsideEmoji = emojiStart + 2;
  process.stdout.write(output.subarray(0, splitInsideEmoji));
  setTimeout(() => process.stdout.write(output.subarray(splitInsideEmoji)), 25);
} else {
  process.stdout.write(`${JSON.stringify({ type: 'text', part: { text: message } })}\n`);
}
