'use strict';
const express = require('express');

function createGatewayAdminRouter({ store, gatewayService, requireAdmin, requestAuditor }) {
  const router = express.Router();
  router.use(requireAdmin);
  function workers(state = gatewayService.snapshot()) {
    return state.pool.workers.map(({ id, status, capacity, running, version }) => ({ id, status, capacity, running, version }));
  }
  router.get('/health', (_req, res) => {
    const state = gatewayService.snapshot();
    const currentWorkers = workers(state);
    const healthy = currentWorkers.filter((worker) => worker.status === 'healthy').length;
    res.json({ status: state.status === 'running' && healthy === currentWorkers.length && healthy > 0 ? 'healthy' : 'degraded', running: state.running, queued: state.queue.totalQueued, healthyWorkers: healthy });
  });
  router.get('/workers', (_req, res) => res.json({ workers: workers() }));
  router.get('/jobs', (_req, res) => res.json({ jobs: store.listJobMetadata() }));
  router.post('/jobs/:id/cancel', async (req, res) => {
    try {
      const id = req.params.id;
      const job = /^[A-Za-z0-9_-]{1,200}$/.test(id) ? store.getJob({ id }) : null;
      if (!job) return res.status(404).json({ error: { code: 'JOB_NOT_FOUND', message: 'Job was not found' } });
      const result = await gatewayService.cancel({ jobId: id, conversationId: job.conversationId, userId: job.userId });
      requestAuditor.record(req, { action: 'gateway.admin.cancel', targetType: 'gateway_job', targetId: id, metadata: { ownerUserId: job.userId } });
      res.json({ job: { id: result.id, status: result.status } });
    } catch {
      // Upstream failures can contain private inputs or internal connection details.
      res.status(503).json({ error: { code: 'GATEWAY_CANCEL_FAILED', message: 'Unable to confirm cancellation; refresh job status before retrying' } });
    }
  });
  return router;
}
module.exports = { createGatewayAdminRouter };
