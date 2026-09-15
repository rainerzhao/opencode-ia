'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { collectProductionReadiness } = require('../../scripts/collect-production-readiness');

test('collects both passing gates into a safe release-readiness report', () => {
  const report = collectProductionReadiness({
    now: () => '2026-09-15T00:00:00.000Z',
    validateProduction: () => ({ database: 'mysql', cookieSecure: true, uid: 1001, runtime: '/private/opencode' }),
    validateProvider: () => ({ providers: ['internal'], model: 'internal/qwen', file: '/private/opencode.json' })
  });

  assert.deepEqual(report, {
    schemaVersion: 1,
    generatedAt: '2026-09-15T00:00:00.000Z',
    status: 'ready',
    checks: [
      { id: 'production-config', status: 'pass' },
      { id: 'opencode-provider', status: 'pass' }
    ],
    summary: { database: 'mysql', secureCookie: true, nonRoot: true, providerCount: 1 }
  });
  assert.doesNotMatch(JSON.stringify(report), /private|https:|secret|qwen/i);
  assert.equal(Object.isFrozen(report), true);
});

test('reports both gate failures with codes while excluding unsafe error details', () => {
  const productionError = Object.assign(new Error('mysql://admin:secret@private-db/workbench'), { code: 'PRODUCTION_CONFIG_INVALID' });
  const providerError = Object.assign(new Error('/etc/opencode.json contains https://provider.intra/v1'), { code: 'OPENCODE_PROVIDER_CONFIG_INVALID' });
  const report = collectProductionReadiness({
    now: () => '2026-09-15T00:00:00.000Z',
    validateProduction: () => { throw productionError; },
    validateProvider: () => { throw providerError; }
  });

  assert.equal(report.status, 'not_ready');
  assert.deepEqual(report.checks, [
    { id: 'production-config', status: 'fail', code: 'PRODUCTION_CONFIG_INVALID', message: '生产配置检查未通过' },
    { id: 'opencode-provider', status: 'fail', code: 'OPENCODE_PROVIDER_CONFIG_INVALID', message: 'OpenCode Provider 配置检查未通过' }
  ]);
  assert.deepEqual(report.summary, { database: 'unknown', secureCookie: false, nonRoot: false, providerCount: 0 });
  assert.doesNotMatch(JSON.stringify(report), /private-db|secret|opencode\.json|https:/i);
});
