'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
function read(relative) { return fs.readFileSync(path.join(root, relative), 'utf8'); }

test('deployment templates keep runtime, database and proxy boundaries explicit', () => {
  const dockerfile = read('deploy/Dockerfile');
  const compose = read('deploy/compose.intranet.yaml');
  const systemd = read('deploy/systemd/opencode-workbench.service');
  const nginx = read('deploy/nginx/opencode-workbench.conf');
  const runbook = read('docs/operations/intranet-deployment.md');
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /CMD \["node", "server\.js"\]/);
  assert.match(compose, /image: mysql:8\.4/);
  assert.match(compose, /WORKBENCH_DATABASE_URL:/);
  assert.match(compose, /OPENCODE_CMD: \/opt\/opencode\/bin\/opencode/);
  assert.match(systemd, /User=opencode/);
  assert.match(systemd, /NoNewPrivileges=true/);
  assert.match(nginx, /proxy_set_header Upgrade \$http_upgrade/);
  assert.match(nginx, /proxy_set_header Connection \$connection_upgrade/);
  assert.match(runbook, /不包含任何真实密码、证书或 Provider 配置/);
  assert.doesNotMatch(`${dockerfile}\n${compose}\n${systemd}\n${nginx}`, /\bsk-[A-Za-z0-9_-]{16,}\b/);
});
