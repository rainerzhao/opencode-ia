#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function providerConfigError(message) {
  const error = new Error(message);
  error.code = 'OPENCODE_PROVIDER_CONFIG_INVALID';
  return error;
}

function validateOpenCodeProviderConfig({
  env = process.env,
  uid = process.getuid?.(),
  statSync = fs.statSync,
  readFileSync = fs.readFileSync
} = {}) {
  const filename = env.OPENCODE_CONFIG_FILE;
  if (typeof filename !== 'string' || filename.trim() === '') {
    throw providerConfigError('OPENCODE_CONFIG_FILE is required for provider preflight');
  }
  if (!path.isAbsolute(filename)) {
    throw providerConfigError('OPENCODE_CONFIG_FILE must be an absolute path');
  }

  let stat;
  try { stat = statSync(filename); } catch { throw providerConfigError('OPENCODE_CONFIG_FILE does not exist'); }
  if (!stat.isFile()) throw providerConfigError('OPENCODE_CONFIG_FILE must be a regular file');
  if ((stat.mode & 0o077) !== 0) throw providerConfigError('OPENCODE_CONFIG_FILE must be owner-readable only (0600)');
  if (Number.isInteger(uid) && Number.isInteger(stat.uid) && stat.uid !== uid) {
    throw providerConfigError('OPENCODE_CONFIG_FILE must be owned by the service account');
  }

  let config;
  try { config = JSON.parse(readFileSync(filename, 'utf8')); } catch { throw providerConfigError('OpenCode provider config must be valid JSON'); }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw providerConfigError('OpenCode provider config must be a JSON object');
  }
  if (!config.provider || typeof config.provider !== 'object' || Array.isArray(config.provider)) {
    throw providerConfigError('OpenCode provider config must declare provider');
  }
  const providers = Object.entries(config.provider);
  if (providers.length === 0) throw providerConfigError('OpenCode provider config must declare at least one provider');
  for (const [id, provider] of providers) {
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(id) || !provider || typeof provider !== 'object' || Array.isArray(provider)) {
      throw providerConfigError('OpenCode provider entries are invalid');
    }
    const options = provider.options;
    const baseUrl = options && (options.baseURL || options.baseUrl);
    if (typeof baseUrl !== 'string' || !/^https?:\/\//i.test(baseUrl)) {
      throw providerConfigError(`OpenCode provider ${id} must declare an HTTP(S) base URL`);
    }
  }
  if (typeof config.model !== 'string' || config.model.trim() === '') {
    throw providerConfigError('OpenCode provider config must declare a default model');
  }
  return Object.freeze({ file: filename, providers: providers.map(([id]) => id), model: config.model });
}

function main() {
  const result = validateOpenCodeProviderConfig();
  console.log(`OpenCode Provider 配置检查通过：${result.providers.length} 个 Provider，默认模型 ${result.model}`);
  return result;
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { validateOpenCodeProviderConfig, main };
