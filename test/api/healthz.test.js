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

test('exposes aggregate metrics without authentication or private request data', async (t) => {
  const fixture = await createAuthenticatedWorkbench(t);
  const response = await fetch(`${fixture.origin}/metrics`);
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /workbench_http_requests_total/);
  assert.match(body, /workbench_gateway_workers_total 0/);
  assert.doesNotMatch(body, /password|secret|username|conversation|provider/i);
});
