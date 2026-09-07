'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveWithinRoot } = require('../security/path-policy');
const { GATEWAY_EVENT_TYPES } = require('../../packages/shared/gateway-events');
const { recoverGateway } = require('./recovery');

function serviceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${name} is invalid`);
  return value;
}

function requiredString(value, name) {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\0')) {
    throw new TypeError(`${name} is invalid`);
  }
  return value;
}

function safeSegment(value, name) {
  const segment = requiredString(value, name);
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(segment)) {
    throw serviceError('INVALID_WORKSPACE_ID', `${name} cannot be used in a workspace path`);
  }
  return segment;
}

function responseText(response) {
  if (!response || !Array.isArray(response.parts)) return '';
  return response.parts
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
}

function createGatewayService({
  store,
  pool,
  queue,
  workspaceRoot,
  limits = {},
  idFactory = crypto.randomUUID,
  logger = { error() {} }
}) {
  for (const [dependency, name] of [[store, 'store'], [pool, 'pool'], [queue, 'queue']]) {
    if (!dependency || typeof dependency !== 'object') throw new TypeError(`gateway ${name} is required`);
  }
  if (typeof workspaceRoot !== 'string' || !path.isAbsolute(workspaceRoot)) {
    throw new TypeError('gateway workspace root must be absolute');
  }
  const globalRunning = positiveInteger(limits.globalRunning ?? 2, 'global running limit');
  const userRunningLimit = positiveInteger(limits.userRunning ?? 1, 'user running limit');
  const jobTimeoutMs = positiveInteger(limits.jobTimeoutMs ?? 120_000, 'job timeout');
  if (typeof idFactory !== 'function') throw new TypeError('gateway id factory is invalid');

  const active = new Map();
  const runningByUser = new Map();
  const runningConversations = new Set();
  const subscriptions = new Map();
  let state = 'stopped';
  let scheduling = null;
  let unsubscribeExits = null;
  let unsubscribeStatuses = null;
  let recoveryReport = null;

  function workspaceFor(item) {
    const relative = `${safeSegment(item.userId, 'user id')}/${safeSegment(item.conversationId, 'conversation id')}`;
    const directory = resolveWithinRoot(workspaceRoot, relative);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    return directory;
  }

  function canRun(item) {
    return (runningByUser.get(item.userId) || 0) < userRunningLimit &&
      !runningConversations.has(item.conversationId);
  }

  function setRunning(item, delta) {
    const next = (runningByUser.get(item.userId) || 0) + delta;
    if (next > 0) runningByUser.set(item.userId, next);
    else runningByUser.delete(item.userId);
    if (delta > 0) runningConversations.add(item.conversationId);
    else runningConversations.delete(item.conversationId);
  }

  function transitionIfRunning(context, event, errorCode) {
    const job = store.getJob({ id: context.item.id });
    if (job?.status !== 'running') return job;
    const transitioned = store.transitionJob({
      jobId: context.item.id,
      userId: context.item.userId,
      event,
      ...(errorCode ? { errorCode } : {})
    });
    publishConversation(context.item.conversationId, context.item.userId);
    return transitioned;
  }

  function deliver(subscription, event) {
    if (event.sequence <= subscription.cursor) return;
    try {
      subscription.onEvent(event);
      subscription.cursor = event.sequence;
    } catch {
      logger.error('Gateway event subscriber failed');
    }
  }

  function publishConversation(conversationId, userId) {
    const listeners = subscriptions.get(conversationId);
    if (!listeners?.size) return;
    const minimum = Math.min(...[...listeners].map((listener) => listener.cursor));
    const events = store.listEventsAfter({
      conversationId,
      ownerUserId: userId,
      afterSequence: minimum
    }) || [];
    for (const event of events) {
      for (const subscription of listeners) deliver(subscription, event);
    }
  }

  async function execute(context) {
    const { item, lease } = context;
    const directory = workspaceFor(item);
    context.directory = directory;
    const timeout = setTimeout(() => {
      context.timedOut = true;
      context.controller.abort();
    }, jobTimeoutMs);
    timeout.unref();
    try {
      store.transitionJob({
        jobId: item.id,
        userId: item.userId,
        event: 'start',
        workerId: lease.workerId
      });
      publishConversation(item.conversationId, item.userId);
      let binding = store.getOpenCodeSession({ conversationId: item.conversationId });
      if (binding?.recoveryStatus !== 'active') binding = null;
      if (!binding) {
        const conversation = store.getOwnedConversation({
          id: item.conversationId,
          ownerUserId: item.userId
        });
        const session = await lease.client.createSession({
          directory,
          title: conversation.title,
          ...(conversation.defaultModel ? { model: conversation.defaultModel } : {}),
          signal: context.controller.signal
        });
        if (context.cancelled || context.interrupted || context.timedOut) {
          throw serviceError('GATEWAY_EXECUTION_STOPPED', 'gateway execution stopped');
        }
        binding = store.bindOpenCodeSession({
          id: idFactory(),
          conversationId: item.conversationId,
          opencodeSessionId: session.id,
          workerId: lease.workerId,
          workspacePath: directory
        });
      }
      context.binding = binding;
      store.attachJobBinding({
        jobId: item.id,
        workerId: lease.workerId,
        bindingId: binding.id
      });
      const response = await lease.client.prompt({
        sessionId: binding.opencodeSessionId,
        directory,
        text: item.inputText,
        signal: context.controller.signal
      });
      if (context.cancelled || context.interrupted || context.timedOut) {
        throw serviceError('GATEWAY_EXECUTION_STOPPED', 'gateway execution stopped');
      }
      const text = responseText(response);
      if (text) {
        store.appendEvent({
          conversationId: item.conversationId,
          jobId: item.id,
          type: GATEWAY_EVENT_TYPES.MESSAGE_DELTA,
          payload: { text }
        });
        publishConversation(item.conversationId, item.userId);
      }
      transitionIfRunning(context, 'complete');
    } catch (error) {
      if (context.cancelled || context.interrupted) return;
      if (context.timedOut) {
        transitionIfRunning(context, 'timeout', 'GATEWAY_JOB_TIMEOUT');
        return;
      }
      transitionIfRunning(context, 'fail', error.code || 'GATEWAY_EXECUTION_FAILED');
      logger.error('Gateway job failed');
    } finally {
      clearTimeout(timeout);
    }
  }

  function launch(item, lease) {
    const context = {
      item,
      lease,
      controller: new AbortController(),
      cancelled: false,
      interrupted: false,
      timedOut: false,
      binding: null,
      directory: null,
      promise: null
    };
    active.set(item.id, context);
    setRunning(item, 1);
    context.promise = execute(context).finally(() => {
      active.delete(item.id);
      setRunning(item, -1);
      pool.release(lease);
      schedule();
    });
  }

  function dispatch() {
    while (state === 'running' && active.size < globalRunning) {
      let selectedLease = null;
      const item = queue.nextEligible((candidate) => {
        if (!canRun(candidate)) return false;
        const binding = store.getOpenCodeSession({ conversationId: candidate.conversationId });
        selectedLease = pool.acquire({
          conversationId: candidate.conversationId,
          ...(binding?.workerId ? { preferredWorkerId: binding.workerId } : {})
        });
        return Boolean(selectedLease);
      });
      if (!item) break;
      launch(item, selectedLease);
    }
  }

  function schedule() {
    if (!scheduling) {
      scheduling = Promise.resolve().then(dispatch).finally(() => { scheduling = null; });
    }
    return scheduling;
  }

  function handleWorkerExit(event) {
    for (const lease of event.leases || []) {
      const context = [...active.values()].find((item) => item.lease.token === lease.token);
      if (!context || context.interrupted) continue;
      context.interrupted = true;
      context.controller.abort();
      transitionIfRunning(context, 'interrupt', event.reason || 'WORKER_EXITED');
    }
    schedule();
  }

  function handleWorkerStatus(worker) {
    store.upsertWorker({
      id: worker.id,
      instanceId: worker.instanceId,
      status: worker.status,
      endpoint: worker.endpoint,
      processId: worker.processId,
      version: worker.version,
      capacity: worker.capacity
    });
  }

  async function start() {
    if (state === 'running') return snapshot();
    if (typeof pool.subscribeExits === 'function') unsubscribeExits = pool.subscribeExits(handleWorkerExit);
    if (typeof pool.subscribeStatuses === 'function') {
      unsubscribeStatuses = pool.subscribeStatuses(handleWorkerStatus);
    }
    try {
      fs.mkdirSync(workspaceRoot, { recursive: true, mode: 0o700 });
      recoveryReport = await recoverGateway({ store, pool, queue, workspaceRoot });
      state = 'running';
      await schedule();
      return snapshot();
    } catch (error) {
      await pool.stop().catch(() => {});
      unsubscribeExits?.();
      unsubscribeStatuses?.();
      unsubscribeExits = null;
      unsubscribeStatuses = null;
      state = 'stopped';
      throw error;
    }
  }

  function submit({ conversationId, userId, idempotencyKey, inputText }) {
    if (state !== 'running') throw serviceError('GATEWAY_UNAVAILABLE', 'gateway is not running');
    const existing = store.getJobByIdempotency({ userId, idempotencyKey });
    if (existing) {
      return store.createJob({ conversationId, userId, idempotencyKey, inputText });
    }
    if (!queue.canEnqueue(userId)) {
      throw serviceError('USER_QUEUE_LIMIT', 'user queue limit reached');
    }
    const job = store.createJob({ conversationId, userId, idempotencyKey, inputText });
    queue.enqueue(job);
    publishConversation(conversationId, userId);
    schedule();
    return job;
  }

  async function cancel({ conversationId, jobId, userId }) {
    const job = store.getJob({ id: jobId, userId });
    if (!job || (conversationId && job.conversationId !== conversationId)) {
      throw serviceError('JOB_NOT_FOUND', 'job was not found');
    }
    if (job.status === 'queued') {
      queue.remove(job.id);
      const cancelled = store.transitionJob({ jobId, userId, event: 'cancel' });
      publishConversation(job.conversationId, userId);
      return cancelled;
    }
    if (job.status !== 'running') return job;
    const context = active.get(job.id);
    if (!context) return job;
    context.cancelled = true;
    context.controller.abort();
    if (context.binding && context.directory) {
      await context.lease.client.abortSession({
        sessionId: context.binding.opencodeSessionId,
        directory: context.directory
      }).catch(() => {});
    }
    return transitionIfRunning(context, 'cancel');
  }

  async function waitForIdle() {
    while (active.size > 0 || queue.snapshot().totalQueued > 0 || scheduling) {
      const promises = [...active.values()].map((context) => context.promise);
      if (scheduling) promises.push(scheduling);
      if (promises.length > 0) await Promise.race(promises);
      else await new Promise((resolve) => setImmediate(resolve));
    }
  }

  async function stop() {
    if (state === 'stopped') return snapshot();
    state = 'stopping';
    unsubscribeExits?.();
    unsubscribeExits = null;
    for (const context of active.values()) {
      context.interrupted = true;
      context.controller.abort();
      transitionIfRunning(context, 'interrupt', 'GATEWAY_STOPPED');
    }
    await Promise.allSettled([...active.values()].map((context) => context.promise));
    await pool.stop();
    unsubscribeStatuses?.();
    unsubscribeStatuses = null;
    state = 'stopped';
    return snapshot();
  }

  function recover() {
    return { queuedJobs: queue.snapshot().totalQueued };
  }

  function subscribe({ conversationId, userId, afterSequence = 0, onEvent }) {
    if (typeof onEvent !== 'function') throw new TypeError('gateway event listener is required');
    const conversation = store.getOwnedConversation({ id: conversationId, ownerUserId: userId });
    if (!conversation) throw serviceError('CONVERSATION_NOT_FOUND', 'conversation was not found');
    if (!Number.isInteger(afterSequence) || afterSequence < 0) {
      throw serviceError('INVALID_EVENT_SEQUENCE', 'event sequence is invalid');
    }
    const latestSequence = store.getLatestEventSequence({
      conversationId,
      ownerUserId: userId
    });
    const replayEvents = store.listEventsAfter({
      conversationId,
      ownerUserId: userId,
      afterSequence,
      limit: 1000
    }) || [];
    const subscription = { cursor: afterSequence, onEvent, userId };
    const replayTruncated = replayEvents.length === 1000 && replayEvents.at(-1).sequence < latestSequence;
    if (afterSequence === 0 || afterSequence > latestSequence || replayTruncated) {
      const recoveryBoundary = afterSequence > latestSequence || replayTruncated;
      const snapshotSequence = recoveryBoundary ? latestSequence : 0;
      onEvent({
        type: GATEWAY_EVENT_TYPES.CONVERSATION_SNAPSHOT,
        conversationId,
        jobId: null,
        sequence: snapshotSequence,
        occurredAt: new Date().toISOString(),
        data: {
          conversation,
          recoveryBoundary
        }
      });
      subscription.cursor = snapshotSequence;
    }
    if (!replayTruncated && afterSequence <= latestSequence) {
      for (const event of replayEvents) deliver(subscription, event);
    }
    let listeners = subscriptions.get(conversationId);
    if (!listeners) {
      listeners = new Set();
      subscriptions.set(conversationId, listeners);
    }
    listeners.add(subscription);
    return () => {
      listeners.delete(subscription);
      if (listeners.size === 0) subscriptions.delete(conversationId);
    };
  }

  function snapshot() {
    return {
      status: state,
      running: active.size,
      queue: queue.snapshot(),
      pool: pool.snapshot(),
      recovery: recoveryReport
    };
  }

  return { cancel, recover, snapshot, start, stop, submit, subscribe, waitForIdle };
}

module.exports = { createGatewayService };
