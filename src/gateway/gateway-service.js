'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveWithinRoot, secureWorkspaceTree } = require('../security/path-policy');
const { GATEWAY_EVENT_TYPES } = require('../../packages/shared/gateway-events');
const { recoverGateway } = require('./recovery');
const { WORKSPACE_PROMPT_TOOLS } = require('./tool-policy');
const { normalizeSkillFiles } = require('../skills/skill-package');

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

function hasCompletedSkillLoad(response, slug) {
  if (!response || !Array.isArray(response.parts)) return false;
  return response.parts.some((part) =>
    part?.type === 'tool' &&
    part.tool === 'skill' &&
    part?.state?.status === 'completed' &&
    part?.state?.input?.name === slug &&
    typeof part?.state?.output === 'string' &&
    part.state.output.trim().length > 0 &&
    !part?.state?.error
  );
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function discoveredSkillNames(value) {
  const list = Array.isArray(value) ? value : Array.isArray(value?.skills) ? value.skills : null;
  if (list) {
    return list.map((item) => typeof item === 'string' ? item : item?.name || item?.id)
      .filter((item) => typeof item === 'string');
  }
  if (value && typeof value === 'object') return Object.keys(value);
  return [];
}

function isPromise(value) {
  return value !== null && typeof value === 'object' && typeof value.then === 'function';
}

function createGatewayService({
  store,
  pool,
  queue,
  workspaceRoot,
  workspacePreparer = null,
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
  if (workspacePreparer !== null && typeof workspacePreparer?.prepare !== 'function') {
    throw new TypeError('gateway workspace preparer is invalid');
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
  const runtimeRecoveries = new Map();
  const workerMetadataOperations = new Set();
  const validationOperations = new Set();
  const validationControllers = new Set();
  let activeValidations = 0;
  let validationTail = Promise.resolve();

  function trackWorkerMetadata(operation) {
    if (!isPromise(operation)) return operation;
    workerMetadataOperations.add(operation);
    operation.then(
      () => workerMetadataOperations.delete(operation),
      () => {
        workerMetadataOperations.delete(operation);
        logger.error('Gateway worker metadata persistence failed');
      }
    );
    return operation;
  }

  function workspaceFor(item) {
    const userSegment = safeSegment(item.userId, 'user id');
    const conversationSegment = safeSegment(item.conversationId, 'conversation id');
    const userDirectory = resolveWithinRoot(workspaceRoot, userSegment);
    fs.mkdirSync(userDirectory, { recursive: true, mode: 0o700 });
    fs.chmodSync(userDirectory, 0o700);
    const workspaceKey = workspacePreparer?.workspaceKey?.({ userId: item.userId });
    if (workspaceKey !== undefined && (typeof workspaceKey !== 'string' || !/^[a-z0-9-]{1,100}$/.test(workspaceKey))) {
      throw serviceError('GATEWAY_WORKSPACE_PREPARATION_FAILED', 'gateway workspace key is invalid');
    }
    const relative = workspaceKey
      ? `${userSegment}/${conversationSegment}/${workspaceKey}`
      : `${userSegment}/${conversationSegment}`;
    const directory = resolveWithinRoot(workspaceRoot, relative);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(directory, 0o700);
    secureWorkspaceTree(directory);
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

  async function transitionIfRunning(context, event, errorCode) {
    const job = await store.getJob({ id: context.item.id });
    if (job?.status !== 'running') return job;
    const transitioned = await store.transitionJob({
      jobId: context.item.id,
      userId: context.item.userId,
      event,
      ...(errorCode ? { errorCode } : {})
    });
    await publishConversation(context.item.conversationId, context.item.userId);
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

  async function publishConversation(conversationId, userId) {
    const listeners = subscriptions.get(conversationId);
    if (!listeners?.size) return;
    const minimum = Math.min(...[...listeners].map((listener) => listener.cursor));
    const events = await store.listEventsAfter({
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
    let directory;
    let timeout;
    try {
      await store.transitionJob({
        jobId: item.id,
        userId: item.userId,
        event: 'start',
        workerId: lease.workerId
      });
      await publishConversation(item.conversationId, item.userId);
      directory = workspaceFor(item);
      context.directory = directory;
      workspacePreparer?.prepare({ userId: item.userId, directory });
      timeout = setTimeout(() => {
        context.timedOut = true;
        context.controller.abort();
      }, jobTimeoutMs);
      timeout.unref();
      let binding = await store.getOpenCodeSession({ conversationId: item.conversationId });
      if (binding?.recoveryStatus !== 'active' || binding?.workspacePath !== directory) binding = null;
      if (!binding) {
        const conversation = await store.getOwnedConversation({
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
        binding = await store.bindOpenCodeSession({
          id: idFactory(),
          conversationId: item.conversationId,
          opencodeSessionId: session.id,
          workerId: lease.workerId,
          workspacePath: directory
        });
      }
      context.binding = binding;
      await store.attachJobBinding({
        jobId: item.id,
        workerId: lease.workerId,
        bindingId: binding.id
      });
      const response = await lease.client.prompt({
        sessionId: binding.opencodeSessionId,
        directory,
        text: item.inputText,
        agent: 'build',
        tools: WORKSPACE_PROMPT_TOOLS,
        signal: context.controller.signal
      });
      secureWorkspaceTree(directory);
      if (context.cancelled || context.interrupted || context.timedOut) {
        throw serviceError('GATEWAY_EXECUTION_STOPPED', 'gateway execution stopped');
      }
      const text = responseText(response);
      if (!text.trim()) {
        throw serviceError('OPENCODE_EMPTY_RESPONSE', 'OpenCode returned no assistant text');
      }
      await store.appendEvent({
        conversationId: item.conversationId,
        jobId: item.id,
        type: GATEWAY_EVENT_TYPES.MESSAGE_DELTA,
        payload: { text }
      });
      await publishConversation(item.conversationId, item.userId);
      await transitionIfRunning(context, 'complete');
    } catch (error) {
      if (context.cancelled || context.interrupted) return;
      if (context.timedOut) {
        if (context.binding && context.directory) {
          await context.lease.client.abortSession({
            sessionId: context.binding.opencodeSessionId,
            directory: context.directory
          }).catch(() => {});
        }
        await transitionIfRunning(context, 'timeout', 'GATEWAY_JOB_TIMEOUT');
        return;
      }
      if (error?.code === 'OPENCODE_UNAVAILABLE') {
        await handleWorkerExit(pool.markUnhealthy(context.lease.workerId, error.code));
        return;
      }
      await transitionIfRunning(context, 'fail', error.code || 'GATEWAY_EXECUTION_FAILED');
      logger.error('Gateway job failed');
    } finally {
      if (timeout) clearTimeout(timeout);
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

  async function dispatch() {
    while (state === 'running' && active.size + activeValidations < globalRunning) {
      let selectedLease = null;
      const item = await queue.nextEligibleAsync(async (candidate) => {
        if (!canRun(candidate)) return false;
        const binding = await store.getOpenCodeSession({ conversationId: candidate.conversationId });
        if (binding?.recoveryStatus === 'recovering') return false;
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

  async function handleWorkerExit(event) {
    for (const lease of event.leases || []) {
      const context = [...active.values()].find((item) => item.lease.token === lease.token);
      if (!context || context.interrupted) continue;
      context.interrupted = true;
      context.controller.abort();
      await transitionIfRunning(context, 'interrupt', event.reason || 'WORKER_EXITED');
    }
    schedule();
  }

  async function interruptQueuedConversation(binding) {
    let interrupted = 0;
    for (const job of await store.listQueuedJobs()) {
      if (job.conversationId !== binding.conversationId || !queue.remove(job.id)) continue;
      await store.transitionJob({
        jobId: job.id,
        userId: job.userId,
        event: 'interrupt',
        errorCode: 'OPENCODE_SESSION_UNAVAILABLE'
      });
      interrupted += 1;
    }
    return interrupted;
  }

  function recoverRuntimeSessions(workerId) {
    if (runtimeRecoveries.has(workerId)) return runtimeRecoveries.get(workerId);
    // Acquiring a lease publishes worker status synchronously. Register a guard
    // before any pool operation so that status callbacks cannot re-enter recovery.
    runtimeRecoveries.set(workerId, Promise.resolve());
    const recovery = (async () => {
      for (const binding of await store.listRecoveringSessions({ workerId })) {
        if (state !== 'running') break;
        let lease;
        try {
          lease = pool.acquire({ conversationId: binding.conversationId, preferredWorkerId: workerId });
          if (!lease || typeof lease.client?.getSession !== 'function') {
            throw serviceError('GATEWAY_RECOVERY_WORKER', 'worker cannot restore the session');
          }
          const session = await lease.client.getSession({
            sessionId: binding.opencodeSessionId,
            directory: binding.workspacePath
          });
          if (session?.id !== binding.opencodeSessionId) {
            throw serviceError('OPENCODE_PROTOCOL_ERROR', 'restored session identity does not match');
          }
          await store.setSessionRecoveryStatus({
            conversationId: binding.conversationId,
            recoveryStatus: 'active',
            workerId
          });
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
          await interruptQueuedConversation(binding);
          await publishConversation(binding.conversationId, binding.ownerUserId);
        } finally {
          if (lease) pool.release(lease);
        }
      }
    })().catch(() => {
      logger.error('Gateway runtime session recovery failed');
    }).finally(() => {
      runtimeRecoveries.delete(workerId);
      if (state === 'running') schedule();
    });
    runtimeRecoveries.set(workerId, recovery);
    return recovery;
  }

  function handleWorkerStatus(worker) {
    const persisted = store.upsertWorker({
      id: worker.id,
      instanceId: worker.instanceId,
      status: worker.status,
      endpoint: worker.endpoint,
      processId: worker.processId,
      version: worker.version,
      capacity: worker.capacity
    });
    const continueAfterPersistence = () => {
      if (state !== 'running') return null;
      if (worker.status === 'unhealthy') return store.markWorkerSessionsRecovering({ workerId: worker.id });
      if (worker.status === 'healthy') return recoverRuntimeSessions(worker.id);
      return null;
    };
    if (!isPromise(persisted)) return continueAfterPersistence();
    return trackWorkerMetadata(persisted.then(continueAfterPersistence));
  }

  async function start() {
    if (state === 'running') return snapshot();
    if (typeof pool.subscribeExits === 'function') unsubscribeExits = pool.subscribeExits(handleWorkerExit);
    if (typeof pool.subscribeStatuses === 'function') {
      unsubscribeStatuses = pool.subscribeStatuses(handleWorkerStatus);
    }
    try {
      fs.mkdirSync(workspaceRoot, { recursive: true, mode: 0o700 });
      fs.chmodSync(workspaceRoot, 0o700);
      recoveryReport = await recoverGateway({ store, pool, queue, workspaceRoot });
      await Promise.all([...workerMetadataOperations]);
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
    if (existing && typeof existing.then === 'function') {
      return existing.then(async (resolvedExisting) => {
        if (resolvedExisting) return store.createJob({ conversationId, userId, idempotencyKey, inputText });
        if (!queue.canEnqueue(userId)) throw serviceError('USER_QUEUE_LIMIT', 'user queue limit reached');
        const job = await store.createJob({ conversationId, userId, idempotencyKey, inputText });
        queue.enqueue(job);
        await publishConversation(conversationId, userId);
        await schedule();
        return job;
      });
    }
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
    const job = await store.getJob({ id: jobId, userId });
    if (!job || (conversationId && job.conversationId !== conversationId)) {
      throw serviceError('JOB_NOT_FOUND', 'job was not found');
    }
    if (job.status === 'queued') {
      queue.remove(job.id);
      const cancelled = await store.transitionJob({ jobId, userId, event: 'cancel' });
      await publishConversation(job.conversationId, userId);
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
    while (active.size > 0 || queue.snapshot().totalQueued > 0 || scheduling ||
      runtimeRecoveries.size > 0 || validationOperations.size > 0) {
      const promises = [...active.values()].map((context) => context.promise);
      if (scheduling) promises.push(scheduling);
      promises.push(...runtimeRecoveries.values());
      promises.push(...validationOperations);
      if (promises.length > 0) await Promise.race(promises);
      else await new Promise((resolve) => setImmediate(resolve));
    }
  }

  async function performSkillValidation(input) {
    if (state !== 'running') throw serviceError('GATEWAY_UNAVAILABLE', 'gateway is not running');
    const ownerUserId = safeSegment(input?.ownerUserId, 'owner user id');
    const skillId = safeSegment(input?.skillId, 'skill id');
    const versionId = safeSegment(input?.versionId, 'version id');
    const slug = safeSegment(input?.slug, 'skill slug');
    const skillMd = requiredString(input?.skillMd, 'skill source');
    if (!/^[a-f0-9]{64}$/.test(input?.contentSha256 || '')) {
      throw serviceError('INVALID_SKILL_PACKAGE', 'skill package digest is invalid');
    }
    const files = normalizeSkillFiles(input?.files || [], skillMd);
    const deadline = Date.now() + jobTimeoutMs;
    while (active.size > 0 || queue.snapshot().totalQueued > 0 || scheduling ||
      (runningByUser.get(ownerUserId) || 0) >= userRunningLimit) {
      if (state !== 'running') throw serviceError('GATEWAY_UNAVAILABLE', 'gateway is not running');
      if (Date.now() >= deadline) {
        throw serviceError('SKILL_RUNTIME_QUEUE_TIMEOUT', 'skill runtime validation timed out in queue');
      }
      await delay(10);
    }

    const validationId = `skill-validation-${crypto.randomUUID()}`;
    const lease = pool.acquire({ conversationId: validationId });
    if (!lease) throw serviceError('SKILL_RUNTIME_UNAVAILABLE', 'no OpenCode runtime is available');
    const controller = new AbortController();
    validationControllers.add(controller);
    activeValidations += 1;
    setRunning({ userId: ownerUserId, conversationId: validationId }, 1);
    const startedAt = Date.now();
    let directory = null;
    let timeout = null;
    try {
      const validationRoot = resolveWithinRoot(workspaceRoot, 'skill-validation');
      fs.mkdirSync(validationRoot, { recursive: true, mode: 0o700 });
      fs.chmodSync(validationRoot, 0o700);
      directory = fs.mkdtempSync(path.join(validationRoot, 'run-'));
      fs.chmodSync(directory, 0o700);
      const skillRoot = resolveWithinRoot(directory, `.opencode/skills/${slug}`);
      fs.mkdirSync(skillRoot, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(skillRoot, 'SKILL.md'), skillMd, { flag: 'wx', mode: 0o600 });
      for (const file of files) {
        const target = resolveWithinRoot(skillRoot, file.path);
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        fs.writeFileSync(target, file.content, { flag: 'wx', mode: 0o600 });
      }
      secureWorkspaceTree(directory);
      timeout = setTimeout(() => controller.abort(), Math.max(1, deadline - Date.now()));
      timeout.unref();

      const catalog = await lease.client.requestJson('/skill', {
        directory,
        signal: controller.signal
      });
      if (!discoveredSkillNames(catalog).includes(slug)) {
        throw serviceError('SKILL_RUNTIME_DISCOVERY_FAILED', 'OpenCode did not discover the Skill');
      }
      const marker = `SKILL_VALIDATION_OK_${crypto.randomBytes(12).toString('hex')}`;
      const session = await lease.client.createSession({
        directory,
        title: `Validate Skill ${slug}`,
        signal: controller.signal
      });
      const response = await lease.client.prompt({
        sessionId: session.id,
        directory,
        agent: 'build',
        tools: WORKSPACE_PROMPT_TOOLS,
        signal: controller.signal,
        text: [
          `OpenCode Skill validation marker: ${marker}`,
          `Load the locally discovered Skill named ${slug}.`,
          'Do not run shell commands, access the network, use subagents, or read outside this workspace.',
          `After loading its instructions, reply with exactly ${marker} and no other text.`
        ].join('\n')
      });
      secureWorkspaceTree(directory);
      const actual = responseText(response).trim();
      const nativeSkillLoadCompleted = hasCompletedSkillLoad(response, slug);
      if (actual !== marker && !nativeSkillLoadCompleted) {
        const error = serviceError(
          'SKILL_RUNTIME_RESPONSE_INVALID',
          'OpenCode Skill validation response was invalid'
        );
        error.diagnostics = {
          markerIncluded: actual.includes(marker),
          markerLength: marker.length,
          responseLength: actual.length,
          textPartCount: Array.isArray(response?.parts)
            ? response.parts.filter((part) => part?.type === 'text').length
            : 0,
          partTypes: Array.isArray(response?.parts)
            ? response.parts.map((part) => part?.type || 'unknown').slice(0, 20)
            : [],
          toolParts: Array.isArray(response?.parts)
            ? response.parts.filter((part) => part?.type === 'tool').map((part) => ({
              tool: part?.tool || null,
              status: part?.state?.status || null,
              inputKeys: part?.state?.input && typeof part.state.input === 'object'
                ? Object.keys(part.state.input).sort().slice(0, 20)
                : [],
              requestedSkillMatched: [
                part?.state?.input?.name,
                part?.state?.input?.skill,
                part?.state?.input?.slug
              ].includes(slug),
              hasOutput: typeof part?.state?.output === 'string' && part.state.output.length > 0,
              hasError: Boolean(part?.state?.error)
            })).slice(0, 20)
            : []
        };
        throw error;
      }
      return {
        status: 'passed',
        provider: 'opencode-gateway',
        evidence: nativeSkillLoadCompleted ? 'skill-tool-completed' : 'exact-marker',
        durationMs: Date.now() - startedAt
      };
    } catch (error) {
      if (controller.signal.aborted && error?.code !== 'OPENCODE_ABORTED') {
        throw serviceError('SKILL_RUNTIME_TIMEOUT', 'OpenCode Skill validation timed out');
      }
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
      validationControllers.delete(controller);
      if (directory) fs.rmSync(directory, { recursive: true, force: true });
      setRunning({ userId: ownerUserId, conversationId: validationId }, -1);
      activeValidations -= 1;
      pool.release(lease);
      schedule();
    }
  }

  function validateSkillPackage(input) {
    const operation = validationTail.catch(() => {}).then(() => performSkillValidation(input));
    validationTail = operation.catch(() => {});
    validationOperations.add(operation);
    operation.then(
      () => validationOperations.delete(operation),
      () => validationOperations.delete(operation)
    );
    return operation;
  }

  async function stop() {
    if (state === 'stopped') return snapshot();
    state = 'stopping';
    unsubscribeExits?.();
    unsubscribeExits = null;
    for (const context of active.values()) {
      context.interrupted = true;
      context.controller.abort();
      await transitionIfRunning(context, 'interrupt', 'GATEWAY_STOPPED');
    }
    for (const controller of validationControllers) controller.abort();
    await Promise.allSettled([...active.values()].map((context) => context.promise));
    await Promise.allSettled([...validationOperations]);
    await Promise.allSettled([...runtimeRecoveries.values()]);
    await pool.stop();
    unsubscribeStatuses?.();
    unsubscribeStatuses = null;
    state = 'stopped';
    return snapshot();
  }

  function recover() {
    return { queuedJobs: queue.snapshot().totalQueued };
  }

  function createSubscription({ conversationId, userId, afterSequence, onEvent }, conversation, latestSequence, replayEvents) {
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

  function subscribe({ conversationId, userId, afterSequence = 0, onEvent }) {
    if (typeof onEvent !== 'function') throw new TypeError('gateway event listener is required');
    if (!Number.isInteger(afterSequence) || afterSequence < 0) {
      throw serviceError('INVALID_EVENT_SEQUENCE', 'event sequence is invalid');
    }
    const afterConversation = (conversation) => {
      if (!conversation) throw serviceError('CONVERSATION_NOT_FOUND', 'conversation was not found');
      const latest = store.getLatestEventSequence({ conversationId, ownerUserId: userId });
      const events = store.listEventsAfter({ conversationId, ownerUserId: userId, afterSequence, limit: 1000 });
      if (isPromise(latest) || isPromise(events)) {
        return Promise.all([latest, events]).then(([latestSequence, replayEvents]) =>
          createSubscription({ conversationId, userId, afterSequence, onEvent }, conversation, latestSequence, replayEvents || [])
        );
      }
      return createSubscription({ conversationId, userId, afterSequence, onEvent }, conversation, latest, events || []);
    };
    const conversation = store.getOwnedConversation({ id: conversationId, ownerUserId: userId });
    return isPromise(conversation) ? conversation.then(afterConversation) : afterConversation(conversation);
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

  return {
    cancel,
    recover,
    snapshot,
    start,
    stop,
    submit,
    subscribe,
    validateSkillPackage,
    waitForIdle
  };
}

module.exports = { createGatewayService };
