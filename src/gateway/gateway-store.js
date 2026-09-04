'use strict';

const crypto = require('node:crypto');
const { transitionJob: resolveJobTransition } = require('./job-state');
const {
  GATEWAY_EVENT_TYPES,
  assertGatewayEventType
} = require('../../packages/shared/gateway-events');

const WORKER_STATUSES = new Set(['starting', 'healthy', 'unhealthy', 'stopping', 'stopped']);
const RECOVERY_STATUSES = new Set(['active', 'recovering', 'interrupted', 'unavailable']);
const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'cancelled', 'interrupted', 'timed_out']);
const EVENT_FOR_TRANSITION = Object.freeze({
  start: GATEWAY_EVENT_TYPES.JOB_STARTED,
  complete: GATEWAY_EVENT_TYPES.JOB_COMPLETED,
  fail: GATEWAY_EVENT_TYPES.JOB_FAILED,
  cancel: GATEWAY_EVENT_TYPES.JOB_CANCELLED,
  timeout: GATEWAY_EVENT_TYPES.JOB_FAILED,
  interrupt: GATEWAY_EVENT_TYPES.JOB_INTERRUPTED
});

function storeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requiredString(value, code, message, {
  max = 1024,
  trim = true,
  allowLineBreaks = false
} = {}) {
  if (typeof value !== 'string') throw storeError(code, message);
  const normalized = trim ? value.trim() : value;
  const length = Array.from(normalized).length;
  const unsafeControl = allowLineBreaks
    ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
    : /[\u0000-\u001f\u007f]/;
  if (length < 1 || length > max || unsafeControl.test(normalized)) {
    throw storeError(code, message);
  }
  return normalized;
}

function optionalString(value, code, message, options) {
  if (value === null || value === undefined || value === '') return null;
  return requiredString(value, code, message, options);
}

function toConversation(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    title: row.title,
    status: row.status,
    defaultModel: row.default_model,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    userId: row.user_id,
    opencodeSessionBindingId: row.opencode_session_binding_id,
    workerId: row.worker_id,
    idempotencyKey: row.idempotency_key,
    inputText: row.input_text,
    status: row.status,
    errorCode: row.error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  };
}

function toWorker(row) {
  if (!row) return null;
  return {
    id: row.id,
    instanceId: row.instance_id,
    status: row.status,
    endpoint: row.endpoint,
    processId: row.process_id,
    version: row.version,
    capacity: row.capacity,
    lastHeartbeatAt: row.last_heartbeat_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toOpenCodeSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    opencodeSessionId: row.opencode_session_id,
    workerId: row.worker_id,
    workspacePath: row.workspace_path,
    recoveryStatus: row.recovery_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toGatewayEvent(row) {
  if (!row) return null;
  return {
    sequence: row.sequence,
    conversationId: row.conversation_id,
    jobId: row.job_id,
    type: row.type,
    data: JSON.parse(row.payload_json),
    occurredAt: row.created_at
  };
}

function createGatewayStore(db, {
  idFactory = crypto.randomUUID,
  clock = () => new Date().toISOString()
} = {}) {
  const conversationByOwner = db.prepare(`
    SELECT * FROM conversations WHERE id = ? AND owner_user_id = ?
  `);
  const conversationById = db.prepare('SELECT * FROM conversations WHERE id = ?');
  const listConversationsStatement = db.prepare(`
    SELECT * FROM conversations
    WHERE owner_user_id = ? AND status = ?
    ORDER BY updated_at DESC, id DESC
    LIMIT ? OFFSET ?
  `);
  const jobById = db.prepare('SELECT * FROM gateway_jobs WHERE id = ?');
  const jobByIdempotency = db.prepare(`
    SELECT * FROM gateway_jobs WHERE user_id = ? AND idempotency_key = ?
  `);
  const eventBySequence = db.prepare('SELECT * FROM gateway_events WHERE sequence = ?');
  const sessionByConversation = db.prepare(`
    SELECT * FROM opencode_sessions WHERE conversation_id = ?
  `);
  const workerById = db.prepare('SELECT * FROM gateway_workers WHERE id = ?');

  function transaction(action) {
    db.exec('BEGIN IMMEDIATE;');
    try {
      const result = action();
      db.exec('COMMIT;');
      return result;
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  }

  function ensureOwnedConversation(conversationId, ownerUserId) {
    const conversation = conversationByOwner.get(conversationId, ownerUserId);
    if (!conversation) throw storeError('CONVERSATION_NOT_FOUND', 'conversation was not found');
    return conversation;
  }

  function serializePayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw storeError('INVALID_GATEWAY_EVENT', 'gateway event payload is invalid');
    }
    const serialized = JSON.stringify(payload);
    if (Buffer.byteLength(serialized, 'utf8') > 256 * 1024) {
      throw storeError('INVALID_GATEWAY_EVENT', 'gateway event payload is too large');
    }
    return serialized;
  }

  function insertEvent({ conversationId, jobId = null, type, payload = {}, now = clock() }) {
    assertGatewayEventType(type);
    if (!conversationById.get(conversationId)) {
      throw storeError('CONVERSATION_NOT_FOUND', 'conversation was not found');
    }
    if (jobId) {
      const job = jobById.get(jobId);
      if (!job || job.conversation_id !== conversationId) {
        throw storeError('JOB_NOT_FOUND', 'job was not found');
      }
    }
    const result = db.prepare(`
      INSERT INTO gateway_events (conversation_id, job_id, type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(conversationId, jobId, type, serializePayload(payload), now);
    return toGatewayEvent(eventBySequence.get(Number(result.lastInsertRowid)));
  }

  function createConversation({ ownerUserId, title, defaultModel = null }) {
    const id = requiredString(idFactory(), 'INVALID_CONVERSATION_ID', 'conversation id is invalid');
    const owner = requiredString(ownerUserId, 'INVALID_USER_ID', 'user id is invalid');
    const normalizedTitle = requiredString(
      title,
      'INVALID_CONVERSATION_TITLE',
      'conversation title is invalid',
      { max: 200 }
    );
    const model = optionalString(
      defaultModel,
      'INVALID_MODEL_ID',
      'model id is invalid',
      { max: 200 }
    );
    const now = clock();
    try {
      db.prepare(`
        INSERT INTO conversations (
          id, owner_user_id, title, status, default_model, created_at, updated_at
        ) VALUES (?, ?, ?, 'active', ?, ?, ?)
      `).run(id, owner, normalizedTitle, model, now, now);
    } catch (error) {
      if (/FOREIGN KEY constraint failed/.test(error.message)) {
        throw storeError('USER_NOT_FOUND', 'user was not found');
      }
      throw error;
    }
    return toConversation(conversationById.get(id));
  }

  function listConversations({ ownerUserId, status = 'active', limit = 50, offset = 0 }) {
    const owner = requiredString(ownerUserId, 'INVALID_USER_ID', 'user id is invalid');
    if (status !== 'active' && status !== 'archived') {
      throw storeError('INVALID_CONVERSATION_STATUS', 'conversation status is invalid');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw storeError('INVALID_LIMIT', 'conversation limit is invalid');
    }
    if (!Number.isInteger(offset) || offset < 0) {
      throw storeError('INVALID_OFFSET', 'conversation offset is invalid');
    }
    return listConversationsStatement.all(owner, status, limit, offset).map(toConversation);
  }

  function getOwnedConversation({ id, ownerUserId }) {
    return toConversation(conversationByOwner.get(id, ownerUserId));
  }

  function createJob({ conversationId, userId, idempotencyKey, inputText }) {
    const conversation = requiredString(
      conversationId,
      'INVALID_CONVERSATION_ID',
      'conversation id is invalid'
    );
    const user = requiredString(userId, 'INVALID_USER_ID', 'user id is invalid');
    const key = requiredString(
      idempotencyKey,
      'INVALID_IDEMPOTENCY_KEY',
      'idempotency key is invalid',
      { max: 200 }
    );
    const input = requiredString(inputText, 'INVALID_JOB_INPUT', 'job input is invalid', {
      max: 100000,
      allowLineBreaks: true
    });
    ensureOwnedConversation(conversation, user);
    const existing = jobByIdempotency.get(user, key);
    if (existing) {
      if (existing.conversation_id !== conversation || existing.input_text !== input) {
        throw storeError('IDEMPOTENCY_CONFLICT', 'idempotency key was already used');
      }
      return { ...toJob(existing), deduplicated: true };
    }

    const id = requiredString(idFactory(), 'INVALID_JOB_ID', 'job id is invalid');
    const now = clock();
    return transaction(() => {
      db.prepare(`
        INSERT INTO gateway_jobs (
          id, conversation_id, user_id, idempotency_key, input_text, status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)
      `).run(id, conversation, user, key, input, now, now);
      insertEvent({
        conversationId: conversation,
        jobId: id,
        type: GATEWAY_EVENT_TYPES.JOB_QUEUED,
        payload: { status: 'queued' },
        now
      });
      return toJob(jobById.get(id));
    });
  }

  function getJob({ id, userId } = {}) {
    const row = jobById.get(id);
    if (!row || (userId && row.user_id !== userId)) return null;
    return toJob(row);
  }

  function transitionJob({ jobId, userId, event, errorCode = null, workerId, bindingId }) {
    const row = jobById.get(jobId);
    if (!row || (userId && row.user_id !== userId)) {
      throw storeError('JOB_NOT_FOUND', 'job was not found');
    }
    const nextStatus = resolveJobTransition(row.status, event);
    const now = clock();
    const startedAt = event === 'start' ? now : row.started_at;
    const finishedAt = TERMINAL_JOB_STATUSES.has(nextStatus) ? now : row.finished_at;
    const normalizedError = optionalString(
      errorCode,
      'INVALID_JOB_ERROR_CODE',
      'job error code is invalid',
      { max: 100 }
    );
    const nextWorkerId = workerId === undefined ? row.worker_id : workerId;
    const nextBindingId = bindingId === undefined ? row.opencode_session_binding_id : bindingId;

    return transaction(() => {
      db.prepare(`
        UPDATE gateway_jobs
        SET status = ?, error_code = ?, worker_id = ?, opencode_session_binding_id = ?,
            updated_at = ?, started_at = ?, finished_at = ?
        WHERE id = ?
      `).run(
        nextStatus,
        normalizedError,
        nextWorkerId,
        nextBindingId,
        now,
        startedAt,
        finishedAt,
        jobId
      );
      insertEvent({
        conversationId: row.conversation_id,
        jobId,
        type: EVENT_FOR_TRANSITION[event],
        payload: { status: nextStatus, ...(normalizedError ? { errorCode: normalizedError } : {}) },
        now
      });
      return toJob(jobById.get(jobId));
    });
  }

  function appendEvent(input) {
    return insertEvent(input);
  }

  function listEventsAfter({
    conversationId,
    ownerUserId,
    afterSequence = 0,
    limit = 500
  }) {
    if (!conversationByOwner.get(conversationId, ownerUserId)) return null;
    if (!Number.isInteger(afterSequence) || afterSequence < 0) {
      throw storeError('INVALID_EVENT_SEQUENCE', 'event sequence is invalid');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw storeError('INVALID_LIMIT', 'event limit is invalid');
    }
    return db.prepare(`
      SELECT * FROM gateway_events
      WHERE conversation_id = ? AND sequence > ?
      ORDER BY sequence
      LIMIT ?
    `).all(conversationId, afterSequence, limit).map(toGatewayEvent);
  }

  function upsertWorker({
    id,
    instanceId,
    status,
    endpoint = null,
    processId = null,
    version = null,
    capacity = 1,
    lastHeartbeatAt = null
  }) {
    const workerId = requiredString(id, 'INVALID_WORKER_ID', 'worker id is invalid');
    const instance = requiredString(instanceId, 'INVALID_WORKER_INSTANCE', 'worker instance is invalid');
    if (!WORKER_STATUSES.has(status)) throw storeError('INVALID_WORKER_STATUS', 'worker status is invalid');
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 16) {
      throw storeError('INVALID_WORKER_CAPACITY', 'worker capacity is invalid');
    }
    if (processId !== null && (!Number.isInteger(processId) || processId < 1)) {
      throw storeError('INVALID_WORKER_PROCESS', 'worker process id is invalid');
    }
    const normalizedEndpoint = optionalString(
      endpoint,
      'INVALID_WORKER_ENDPOINT',
      'worker endpoint is invalid',
      { max: 500 }
    );
    const normalizedVersion = optionalString(
      version,
      'INVALID_WORKER_VERSION',
      'worker version is invalid',
      { max: 100 }
    );
    const now = clock();
    db.prepare(`
      INSERT INTO gateway_workers (
        id, instance_id, status, endpoint, process_id, version, capacity,
        last_heartbeat_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        instance_id = excluded.instance_id,
        status = excluded.status,
        endpoint = excluded.endpoint,
        process_id = excluded.process_id,
        version = excluded.version,
        capacity = excluded.capacity,
        last_heartbeat_at = excluded.last_heartbeat_at,
        updated_at = excluded.updated_at
    `).run(
      workerId,
      instance,
      status,
      normalizedEndpoint,
      processId,
      normalizedVersion,
      capacity,
      lastHeartbeatAt,
      now,
      now
    );
    return toWorker(workerById.get(workerId));
  }

  function bindOpenCodeSession({
    id,
    conversationId,
    opencodeSessionId,
    workerId = null,
    workspacePath,
    recoveryStatus = 'active'
  }) {
    const bindingId = requiredString(id, 'INVALID_SESSION_BINDING_ID', 'session binding id is invalid');
    if (!conversationById.get(conversationId)) {
      throw storeError('CONVERSATION_NOT_FOUND', 'conversation was not found');
    }
    const opencodeId = requiredString(
      opencodeSessionId,
      'INVALID_OPENCODE_SESSION_ID',
      'OpenCode session id is invalid',
      { max: 200 }
    );
    const workspace = requiredString(
      workspacePath,
      'INVALID_WORKSPACE_PATH',
      'workspace path is invalid',
      { max: 4096, trim: false }
    );
    if (!RECOVERY_STATUSES.has(recoveryStatus)) {
      throw storeError('INVALID_RECOVERY_STATUS', 'recovery status is invalid');
    }
    const now = clock();
    db.prepare(`
      INSERT INTO opencode_sessions (
        id, conversation_id, opencode_session_id, worker_id, workspace_path,
        recovery_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(conversation_id) DO UPDATE SET
        opencode_session_id = excluded.opencode_session_id,
        worker_id = excluded.worker_id,
        workspace_path = excluded.workspace_path,
        recovery_status = excluded.recovery_status,
        updated_at = excluded.updated_at
    `).run(
      bindingId,
      conversationId,
      opencodeId,
      workerId,
      workspace,
      recoveryStatus,
      now,
      now
    );
    return toOpenCodeSession(sessionByConversation.get(conversationId));
  }

  function recoverOnStartup() {
    const now = clock();
    return transaction(() => {
      const runningJobs = db.prepare(`
        SELECT * FROM gateway_jobs WHERE status = 'running' ORDER BY created_at, id
      `).all();
      for (const job of runningJobs) {
        db.prepare(`
          UPDATE gateway_jobs
          SET status = 'interrupted', error_code = 'GATEWAY_RESTARTED',
              updated_at = ?, finished_at = ?
          WHERE id = ?
        `).run(now, now, job.id);
        insertEvent({
          conversationId: job.conversation_id,
          jobId: job.id,
          type: GATEWAY_EVENT_TYPES.JOB_INTERRUPTED,
          payload: { status: 'interrupted', errorCode: 'GATEWAY_RESTARTED' },
          now
        });
      }
      const sessionResult = db.prepare(`
        UPDATE opencode_sessions
        SET recovery_status = 'recovering', updated_at = ?
        WHERE recovery_status = 'active'
      `).run(now);
      const workerResult = db.prepare(`
        UPDATE gateway_workers
        SET status = 'stopped', process_id = NULL, updated_at = ?
        WHERE status != 'stopped'
      `).run(now);
      return {
        interruptedJobs: runningJobs.length,
        recoveringSessions: Number(sessionResult.changes),
        stoppedWorkers: Number(workerResult.changes)
      };
    });
  }

  return {
    appendEvent,
    bindOpenCodeSession,
    createConversation,
    createJob,
    getJob,
    getOwnedConversation,
    listConversations,
    listEventsAfter,
    recoverOnStartup,
    transitionJob,
    upsertWorker
  };
}

module.exports = { createGatewayStore };
