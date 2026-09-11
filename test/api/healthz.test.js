'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthenticatedWorkbench } = require('../fixtures/authenticated-workbench');

test('exposes a non-sensitive unauthenticated health endpoint', async (t) => {
  const fixture = await createAuthenticatedWorkbench(t);
  const response = await fetch(`${fixture.origin}/healthz`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'healthy', database: 'configured', gateway: 'not_configured' });
});
