#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const ignored = new Set(['.git', '.worktrees', 'node_modules', 'data', 'coverage', 'dist', 'build', 'backups']);
const files = [];

function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (!ignored.has(entry.name)) visit(path.join(directory, entry.name));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(path.join(directory, entry.name));
    }
  }
}

visit(root);
files.sort();
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    if (result.error) console.error(`Unable to check ${path.relative(root, file)}: ${result.error.message}`);
    process.exitCode = result.status || 1;
    break;
  }
}
if (!process.exitCode) console.log(`JavaScript syntax check passed: ${files.length} files.`);
