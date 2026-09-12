'use strict';

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function createMetrics({ startedAt = Date.now() } = {}) {
  let requests = 0;
  let errors = 0;
  let activeRequests = 0;
  let gateway = { workersHealthy: 0, workersTotal: 0, queued: 0, running: 0 };

  function beginRequest() {
    activeRequests += 1;
    let ended = false;
    return Object.freeze({
      end(statusCode = 500) {
        if (ended) return;
        ended = true;
        activeRequests = Math.max(0, activeRequests - 1);
        requests += 1;
        if (Number(statusCode) >= 400) errors += 1;
      }
    });
  }

  function recordGateway(value = {}) {
    gateway = {
      workersHealthy: nonNegativeInteger(value.workersHealthy),
      workersTotal: nonNegativeInteger(value.workersTotal),
      queued: nonNegativeInteger(value.queued),
      running: nonNegativeInteger(value.running)
    };
  }

  function snapshot() {
    return { startedAt, requests, errors, activeRequests, gateway: { ...gateway } };
  }

  function toPrometheus() {
    const state = snapshot();
    return [
      '# HELP workbench_http_requests_total Completed HTTP requests.',
      '# TYPE workbench_http_requests_total counter',
      `workbench_http_requests_total ${state.requests}`,
      '# HELP workbench_http_errors_total HTTP responses with status 400 or greater.',
      '# TYPE workbench_http_errors_total counter',
      `workbench_http_errors_total ${state.errors}`,
      '# HELP workbench_http_active_requests Current in-flight HTTP requests.',
      '# TYPE workbench_http_active_requests gauge',
      `workbench_http_active_requests ${state.activeRequests}`,
      '# HELP workbench_gateway_workers_healthy Healthy OpenCode workers.',
      '# TYPE workbench_gateway_workers_healthy gauge',
      `workbench_gateway_workers_healthy ${state.gateway.workersHealthy}`,
      '# HELP workbench_gateway_workers_total Configured OpenCode workers.',
      '# TYPE workbench_gateway_workers_total gauge',
      `workbench_gateway_workers_total ${state.gateway.workersTotal}`,
      '# HELP workbench_gateway_jobs_queued Queued Gateway jobs.',
      '# TYPE workbench_gateway_jobs_queued gauge',
      `workbench_gateway_jobs_queued ${state.gateway.queued}`,
      '# HELP workbench_gateway_jobs_running Running Gateway jobs.',
      '# TYPE workbench_gateway_jobs_running gauge',
      `workbench_gateway_jobs_running ${state.gateway.running}`,
      ''
    ].join('\n');
  }

  return Object.freeze({ beginRequest, recordGateway, snapshot, toPrometheus });
}

module.exports = { createMetrics };
