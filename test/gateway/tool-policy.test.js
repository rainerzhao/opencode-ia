'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  WORKSPACE_PROMPT_TOOLS,
  secureOpenCodeConfigContent
} = require('../../src/gateway/tool-policy');

test('forces workspace isolation without discarding unrelated OpenCode config', () => {
  const secured = JSON.parse(secureOpenCodeConfigContent(JSON.stringify({
    model: 'internal/model',
    permission: {
      edit: 'allow',
      external_directory: { '/tmp/**': 'allow' },
      bash: 'allow'
    },
    agent: {
      build: {
        temperature: 0.2,
        permission: { external_directory: 'allow', bash: 'allow' }
      },
      review: {
        permission: 'allow'
      }
    }
  })));

  assert.equal(secured.model, 'internal/model');
  assert.equal(secured.permission.edit, 'allow');
  assert.equal(secured.permission.external_directory, 'deny');
  assert.equal(secured.permission.bash, 'deny');
  assert.equal(secured.permission.webfetch, 'deny');
  assert.equal(secured.permission.websearch, 'deny');
  assert.equal(secured.permission.task, 'deny');
  assert.equal(secured.agent.build.temperature, 0.2);
  assert.equal(secured.agent.build.permission.external_directory, 'deny');
  assert.equal(secured.agent.build.permission.bash, 'deny');
  assert.equal(secured.agent.review.permission.external_directory, 'deny');
  assert.equal(secured.agent.review.permission.task, 'deny');
});

test('converts a broad permission string into explicit forced denies', () => {
  const secured = JSON.parse(secureOpenCodeConfigContent('{"permission":"allow"}'));
  assert.equal(secured.permission['*'], 'allow');
  assert.equal(secured.permission.external_directory, 'deny');
  assert.equal(secured.agent.build.permission.external_directory, 'deny');
  assert.deepEqual(WORKSPACE_PROMPT_TOOLS, {
    bash: false,
    task: false,
    webfetch: false,
    websearch: false
  });
});

test('fails closed before worker startup when inline OpenCode config is malformed', () => {
  assert.throws(
    () => secureOpenCodeConfigContent('{not-json'),
    /OpenCode config content is invalid/
  );
  assert.throws(
    () => secureOpenCodeConfigContent('[]'),
    /OpenCode config content is invalid/
  );
});
