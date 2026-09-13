#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('../src/config');

// Run inside a disposable built image with --network none. No DB or Provider credentials needed.
const root = path.resolve(__dirname, '..');
const config = loadConfig({ env: process.env, projectDir: root });
assert.notEqual(process.getuid(), 0, 'image must run as a non-root account');
assert.equal(process.env.NODE_ENV, 'production');
assert.equal(config.dataRoot, '/var/lib/opencode-workbench');
fs.accessSync(path.join(config.staticDir, 'index.html'), fs.constants.R_OK);
for (const entry of fs.readdirSync(root)) {
  assert.ok(!['.git', '.github', 'docs', 'test', 'data', 'PROJECT_HANDOFF.md'].includes(entry), `unexpected image entry: ${entry}`);
  assert.ok(!/^\.env(?:\.|$)/.test(entry) || entry === '.env.example', 'runtime environment file entered image');
}
for (const directory of [config.contentAttachmentRoot, config.gatewayWorkspaceRoot, config.skillInstallRoot,
  config.knowledgeDir, config.skillsDir, config.opencodeCwd, config.uploadTempDir,
  ...['XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME'].map((key) => process.env[key])]) {
  assert.equal(typeof directory, 'string', 'persistent directory configuration is missing');
  assert.ok(directory.startsWith(`${config.dataRoot}/`), 'mutable state must stay in the data volume');
  const probe = path.join(directory, `.image-write-probe-${process.pid}`);
  try {
    fs.writeFileSync(probe, 'probe', { flag: 'wx', mode: 0o600 });
    assert.equal(fs.readFileSync(probe, 'utf8'), 'probe');
  } finally {
    if (fs.existsSync(probe)) fs.unlinkSync(probe);
  }
}
console.log('Image verified: non-root, compiled frontend, persistent writable paths, excluded local data.');
