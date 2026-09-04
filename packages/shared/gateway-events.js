'use strict';

const GATEWAY_EVENT_TYPES = Object.freeze({
  JOB_ACCEPTED: 'job.accepted',
  JOB_QUEUED: 'job.queued',
  JOB_STARTED: 'job.started',
  MESSAGE_DELTA: 'message.delta',
  JOB_COMPLETED: 'job.completed',
  JOB_FAILED: 'job.failed',
  JOB_CANCELLED: 'job.cancelled',
  JOB_INTERRUPTED: 'job.interrupted',
  WORKER_STATUS: 'worker.status',
  CONVERSATION_SNAPSHOT: 'conversation.snapshot'
});

const GATEWAY_EVENT_TYPE_VALUES = new Set(Object.values(GATEWAY_EVENT_TYPES));

function assertGatewayEventType(type) {
  if (!GATEWAY_EVENT_TYPE_VALUES.has(type)) {
    const error = new Error('gateway event type is invalid');
    error.code = 'INVALID_GATEWAY_EVENT';
    throw error;
  }
  return type;
}

module.exports = { GATEWAY_EVENT_TYPES, assertGatewayEventType };
