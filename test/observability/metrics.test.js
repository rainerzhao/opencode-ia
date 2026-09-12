'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMetrics } = require('../../src/observability/metrics');

test('records bounded aggregate HTTP metrics without request data', () => {
  const metrics = createMetrics({ startedAt: 1000 });
  const request = metrics.beginRequest();
  assert.equal(metrics.snapshot().activeRequests, 1);
  request.end(200);
  metrics.recordGateway({ workersHealthy: 2, workersTotal: 2, queued: 3, running: 1 });
  const output = metrics.toPrometheus();
  assert.match(output, /workbench_http_requests_total 1/);
  assert.match(output, /workbench_http_errors_total 0/);
  assert.match(output, /workbench_gateway_workers_healthy 2/);
  assert.match(output, /workbench_gateway_jobs_queued 3/);
  assert.doesNotMatch(output, /secret|username|provider|conversation|title/i);
});

test('counts 4xx and 5xx responses as errors and never goes negative', () => {
  const metrics = createMetrics({ startedAt: 1000 });
  metrics.beginRequest().end(404);
  metrics.beginRequest().end(503);
  metrics.beginRequest().end(200);
  assert.deepEqual(metrics.snapshot(), {
    startedAt: 1000, requests: 3, errors: 2, activeRequests: 0,
    gateway: { workersHealthy: 0, workersTotal: 0, queued: 0, running: 0 }
  });
});
