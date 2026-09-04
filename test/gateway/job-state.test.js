'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { transitionJob } = require('../../src/gateway/job-state');

test('moves queued and running jobs through only the supported lifecycle', () => {
  assert.equal(transitionJob('queued', 'start'), 'running');
  assert.equal(transitionJob('queued', 'cancel'), 'cancelled');
  assert.equal(transitionJob('running', 'complete'), 'completed');
  assert.equal(transitionJob('running', 'fail'), 'failed');
  assert.equal(transitionJob('running', 'cancel'), 'cancelled');
  assert.equal(transitionJob('running', 'timeout'), 'timed_out');
  assert.equal(transitionJob('running', 'interrupt'), 'interrupted');
});

test('rejects rollback and mutation after a terminal outcome', () => {
  assert.throws(
    () => transitionJob('running', 'retry'),
    (error) => error.code === 'INVALID_JOB_TRANSITION'
  );
  for (const status of ['completed', 'failed', 'cancelled', 'interrupted', 'timed_out']) {
    assert.throws(
      () => transitionJob(status, 'start'),
      (error) => error.code === 'INVALID_JOB_TRANSITION'
    );
  }
});

test('rejects unknown persisted states and transition events', () => {
  assert.throws(
    () => transitionJob('unknown', 'start'),
    (error) => error.code === 'INVALID_JOB_STATUS'
  );
  assert.throws(
    () => transitionJob('queued', 'unknown'),
    (error) => error.code === 'INVALID_JOB_TRANSITION'
  );
});
