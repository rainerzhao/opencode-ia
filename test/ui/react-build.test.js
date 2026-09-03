'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createAuthenticatedWorkbench } = require('../fixtures/authenticated-workbench');

const root = path.resolve(__dirname, '../..');
const dist = path.join(root, 'dist', 'web');

test('builds a self-contained React workbench without public CDN dependencies', () => {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /assets\/[^"']+\.js/);
  assert.match(html, /assets\/[^"']+\.css/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test('keeps React source grouped by product feature instead of one legacy script', () => {
  for (const relativePath of [
    'apps/web/src/features/auth/LoginPage.jsx',
    'apps/web/src/features/admin/AdminPage.jsx',
    'apps/web/src/features/chat/ChatPage.jsx',
    'apps/web/src/features/knowledge/KnowledgePage.jsx',
    'apps/web/src/features/solutions/SolutionsPage.jsx',
    'apps/web/src/features/skills/SkillsPage.jsx',
    'apps/web/src/shell/WorkbenchShell.jsx',
    'apps/server/index.js',
    'packages/shared/error-codes.js'
  ]) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), true, `missing ${relativePath}`);
  }
});

test('serves the React entry for both workbench and login routes', async (t) => {
  const fixture = await createAuthenticatedWorkbench(t, { staticDir: dist });
  for (const pathname of ['/', '/login.html']) {
    const response = await fetch(`${fixture.origin}${pathname}`);
    assert.equal(response.status, 200, pathname);
    assert.match(await response.text(), /<div id="root"><\/div>/);
  }
});
