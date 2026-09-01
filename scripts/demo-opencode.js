#!/usr/bin/env node

'use strict';

const args = process.argv.slice(2);
const runIndex = args.indexOf('run');
const valid = (
  runIndex !== -1 &&
  args[runIndex + 1] === '--format' &&
  args[runIndex + 2] === 'json' &&
  args[runIndex + 3] === '--' &&
  args.length === runIndex + 5
);

if (!valid) {
  process.stderr.write('Demo runner received invalid arguments\n');
  process.exitCode = 2;
} else {
  const message = args[runIndex + 4];
  const event = {
    type: 'text',
    part: { text: `【Demo 模拟回复】${message}` }
  };
  process.stdout.write(`${JSON.stringify(event)}\n`);
}
