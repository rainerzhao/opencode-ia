'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

function runAdminCli({ root, url = '', username = 'admin', password = 'CLI Bootstrap 2026!', env = {} }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve(__dirname, '../../scripts/create-admin.js'),
      '--username', username, '--display-name', 'Administrator'], {
      env: { ...process.env, NODE_ENV: 'production', WORKBENCH_ROOT: root,
        WORKBENCH_DATABASE_URL: url, MYSQL_URL: '', DATABASE_PATH: '', ...env },
      stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(`${password}\n${password}\n`);
  });
}

module.exports = { runAdminCli };
