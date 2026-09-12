'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateOpenCodeProviderConfig } = require('../../scripts/check-opencode-provider');

function fixtureFile(t, content, mode = 0o600) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-provider-'));
  const file = path.join(root, 'opencode.json');
  fs.writeFileSync(file, content, { mode });
  fs.chmodSync(file, mode);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return file;
}

test('accepts an owner-only OpenAI-compatible provider config without exposing credentials', (t) => {
  const file = fixtureFile(t, JSON.stringify({
    model: 'internal/qwen3-coder',
    provider: { internal: { options: { baseURL: 'https://model.intra.example/v1', apiKey: '${INTERNAL_MODEL_API_KEY}' } } }
  }));
  const result = validateOpenCodeProviderConfig({ env: { OPENCODE_CONFIG_FILE: file } });
  assert.deepEqual(result.providers, ['internal']);
  assert.equal(result.model, 'internal/qwen3-coder');
  assert.doesNotMatch(JSON.stringify(result), /INTERNAL_MODEL_API_KEY|https:\/\//);
});

test('rejects missing provider, unsafe permissions and missing model', (t) => {
  const noProvider = fixtureFile(t, JSON.stringify({ model: 'internal/model' }));
  assert.throws(() => validateOpenCodeProviderConfig({ env: { OPENCODE_CONFIG_FILE: noProvider } }), /declare provider/);
  const openFile = fixtureFile(t, JSON.stringify({ model: 'internal/model', provider: { internal: { options: { baseURL: 'http://x' } } } }), 0o644);
  assert.throws(() => validateOpenCodeProviderConfig({ env: { OPENCODE_CONFIG_FILE: openFile } }), /0600/);
  const noModel = fixtureFile(t, JSON.stringify({ provider: { internal: { options: { baseURL: 'http://x' } } } }));
  assert.throws(() => validateOpenCodeProviderConfig({ env: { OPENCODE_CONFIG_FILE: noModel } }), /default model/);
});
