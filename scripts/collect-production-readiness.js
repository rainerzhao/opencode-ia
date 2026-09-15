#!/usr/bin/env node
'use strict';

const { validateProductionConfig } = require('./check-production-config');
const { validateOpenCodeProviderConfig } = require('./check-opencode-provider');

function attemptGate(id, validate, failure) {
  try {
    return { id, status: 'pass', value: validate() };
  } catch (error) {
    return { id, status: 'fail', code: error?.code || 'PREFLIGHT_FAILED', message: failure };
  }
}

function collectProductionReadiness({
  env = process.env,
  projectDir = process.cwd(),
  uid = process.getuid?.(),
  now = () => new Date().toISOString(),
  validateProduction = (options) => validateProductionConfig(options),
  validateProvider = (options) => validateOpenCodeProviderConfig(options)
} = {}) {
  const production = attemptGate(
    'production-config',
    () => validateProduction({ env, projectDir, uid }),
    '生产配置检查未通过'
  );
  const provider = attemptGate(
    'opencode-provider',
    () => validateProvider({ env, uid }),
    'OpenCode Provider 配置检查未通过'
  );
  const ready = production.status === 'pass' && provider.status === 'pass';
  const checks = [production, provider].map(({ id, status, code, message }) => (
    status === 'pass' ? { id, status } : { id, status, code, message }
  ));
  const report = {
    schemaVersion: 1,
    generatedAt: now(),
    status: ready ? 'ready' : 'not_ready',
    checks,
    summary: {
      database: production.status === 'pass' ? production.value.database : 'unknown',
      secureCookie: production.status === 'pass' && production.value.cookieSecure === true,
      nonRoot: production.status === 'pass' && Number.isInteger(production.value.uid) && production.value.uid !== 0,
      providerCount: provider.status === 'pass' ? provider.value.providers.length : 0
    }
  };
  return Object.freeze(report);
}

function main() {
  const report = collectProductionReadiness();
  console.log(JSON.stringify(report));
  if (report.status !== 'ready') process.exitCode = 1;
  return report;
}

if (require.main === module) main();

module.exports = { collectProductionReadiness, main };
