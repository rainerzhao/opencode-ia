'use strict';

const path = require('node:path');
const { resolveWithinRoot } = require('../security/path-policy');
const { GATEWAY_EVENT_TYPES } = require('../../packages/shared/gateway-events');

function recoveryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertWorkspace(workspaceRoot, workspacePath) {
  const relative = path.relative(workspaceRoot, workspacePath);
  const resolved = resolveWithinRoot(workspaceRoot, relative);
  if (resolved !== path.resolve(workspacePath)) {
    throw recoveryError('GATEWAY_RECOVERY_WORKSPACE', 'session workspace is outside the configured root');
  }
  return resolved;
}

async function recoverGateway({ store, pool, queue, workspaceRoot }) {
  if (!store || !pool || !queue) throw new TypeError('gateway recovery dependencies are required');
  if (typeof workspaceRoot !== 'string' || !path.isAbsolute(workspaceRoot)) {
    throw new TypeError('gateway recovery workspace root must be absolute');
  }
  const report = store.recoverOnStartup();
  const queuedJobs = store.listQueuedJobs();
  // Rebuild from durable truth, including retries on the same service instance.
  while (queue.nextEligible()) {}
  try {
    for (const job of queuedJobs) {
      if (!queue.canEnqueue(job.userId)) {
        throw recoveryError('GATEWAY_RECOVERY_QUEUE_LIMIT', 'persisted queue exceeds the configured user limit');
      }
      queue.enqueue(job);
    }
    await pool.start();
  } catch (error) {
    while (queue.nextEligible()) {}
    throw error;
  }
  let restoredSessions = 0;
  let unavailableSessions = 0;
  for (const binding of store.listRecoveringSessions()) {
    let lease;
    try {
      const directory = assertWorkspace(workspaceRoot, binding.workspacePath);
      lease = pool.acquire({
        conversationId: binding.conversationId,
        ...(binding.workerId ? { preferredWorkerId: binding.workerId } : {})
      });
      if (!lease || typeof lease.client?.getSession !== 'function') {
        throw recoveryError('GATEWAY_RECOVERY_WORKER', 'no worker can restore the session');
      }
      const session = await lease.client.getSession({
        sessionId: binding.opencodeSessionId,
        directory
      });
      if (session?.id !== binding.opencodeSessionId) {
        throw recoveryError('OPENCODE_PROTOCOL_ERROR', 'restored session identity does not match');
      }
      store.setSessionRecoveryStatus({
        conversationId: binding.conversationId,
        recoveryStatus: 'active',
        workerId: lease.workerId
      });
      restoredSessions += 1;
    } catch (error) {
      store.setSessionRecoveryStatus({
        conversationId: binding.conversationId,
        recoveryStatus: 'unavailable',
        workerId: null
      });
      store.appendEvent({
        conversationId: binding.conversationId,
        type: GATEWAY_EVENT_TYPES.CONVERSATION_RECOVERY_BOUNDARY,
        payload: { reason: error?.code || 'OPENCODE_SESSION_UNAVAILABLE' }
      });
      unavailableSessions += 1;
    } finally {
      if (lease) pool.release(lease);
    }
  }

  return {
    ...report,
    requeuedJobs: queuedJobs.length,
    restoredSessions,
    unavailableSessions
  };
}

module.exports = { recoverGateway };
