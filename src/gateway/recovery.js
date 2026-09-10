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
  const report = await store.recoverOnStartup();
  const queuedJobs = await store.listQueuedJobs();
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
  const unavailableConversations = new Set();
  for (const binding of await store.listRecoveringSessions()) {
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
      await store.setSessionRecoveryStatus({
        conversationId: binding.conversationId,
        recoveryStatus: 'active',
        workerId: lease.workerId
      });
      restoredSessions += 1;
    } catch (error) {
      await store.setSessionRecoveryStatus({
        conversationId: binding.conversationId,
        recoveryStatus: 'unavailable',
        workerId: null
      });
      await store.appendEvent({
        conversationId: binding.conversationId,
        type: GATEWAY_EVENT_TYPES.CONVERSATION_RECOVERY_BOUNDARY,
        payload: { reason: error?.code || 'OPENCODE_SESSION_UNAVAILABLE' }
      });
      unavailableSessions += 1;
      unavailableConversations.add(binding.conversationId);
    } finally {
      if (lease) pool.release(lease);
    }
  }

  let interruptedQueuedJobs = 0;
  for (const job of queuedJobs) {
    if (!unavailableConversations.has(job.conversationId) || !queue.remove(job.id)) continue;
    await store.transitionJob({
      jobId: job.id,
      userId: job.userId,
      event: 'interrupt',
      errorCode: 'OPENCODE_SESSION_UNAVAILABLE'
    });
    interruptedQueuedJobs += 1;
  }

  return {
    ...report,
    requeuedJobs: queuedJobs.length - interruptedQueuedJobs,
    interruptedQueuedJobs,
    restoredSessions,
    unavailableSessions
  };
}

module.exports = { recoverGateway };
