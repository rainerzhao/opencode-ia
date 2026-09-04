'use strict';

const TRANSITIONS = Object.freeze({
  queued: Object.freeze({
    start: 'running',
    cancel: 'cancelled'
  }),
  running: Object.freeze({
    complete: 'completed',
    fail: 'failed',
    cancel: 'cancelled',
    timeout: 'timed_out',
    interrupt: 'interrupted'
  }),
  completed: Object.freeze({}),
  failed: Object.freeze({}),
  cancelled: Object.freeze({}),
  interrupted: Object.freeze({}),
  timed_out: Object.freeze({})
});

function stateError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function transitionJob(currentStatus, event) {
  if (!Object.hasOwn(TRANSITIONS, currentStatus)) {
    throw stateError('INVALID_JOB_STATUS', 'job status is invalid');
  }
  const nextStatus = TRANSITIONS[currentStatus][event];
  if (!nextStatus) {
    throw stateError('INVALID_JOB_TRANSITION', 'job transition is invalid');
  }
  return nextStatus;
}

module.exports = { transitionJob };
