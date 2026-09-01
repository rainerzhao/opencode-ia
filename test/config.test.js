const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadConfig } = require('../src/config');

test('derives data paths from the injected project directory', () => {
  const config = loadConfig({ env: {}, projectDir: '/srv/workbench' });
  assert.equal(config.knowledgeDir, path.resolve('/srv/workbench/knowledge'));
  assert.equal(config.solutionsDir, path.resolve('/srv/workbench/solutions'));
  assert.equal(config.port, 3000);
});

test('rejects invalid positive integer limits', () => {
  assert.throws(
    () => loadConfig({ env: { MAX_SESSIONS: '0' }, projectDir: '/srv/workbench' }),
    /MAX_SESSIONS/
  );
});

test('rejects non-integer environment overrides', () => {
  assert.throws(
    () => loadConfig({ env: { PORT: '3000.5' }, projectDir: '/srv/workbench' }),
    /PORT/
  );
});
