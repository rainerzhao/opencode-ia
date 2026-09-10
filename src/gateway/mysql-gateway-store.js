'use strict';

const crypto = require('node:crypto');
const { transitionJob } = require('./job-state');
const { GATEWAY_EVENT_TYPES, assertGatewayEventType } = require('../../packages/shared/gateway-events');
const { toIsoTimestamp, toMySqlTimestamp } = require('../users/mysql-user-store');

const WORKER_STATUSES = new Set(['starting', 'healthy', 'unhealthy', 'stopping', 'stopped']);
const RECOVERY_STATUSES = new Set(['active', 'recovering', 'interrupted', 'unavailable']);
const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'cancelled', 'interrupted', 'timed_out']);
const EVENT_FOR_TRANSITION = Object.freeze({
  start: GATEWAY_EVENT_TYPES.JOB_STARTED, complete: GATEWAY_EVENT_TYPES.JOB_COMPLETED,
  fail: GATEWAY_EVENT_TYPES.JOB_FAILED, cancel: GATEWAY_EVENT_TYPES.JOB_CANCELLED,
  timeout: GATEWAY_EVENT_TYPES.JOB_FAILED, interrupt: GATEWAY_EVENT_TYPES.JOB_INTERRUPTED
});

function error(code, message) { const value = new Error(message); value.code = code; return value; }
function required(value, code, message, { max = 1024, trim = true, lines = false } = {}) {
  if (typeof value !== 'string') throw error(code, message);
  const normalized = trim ? value.trim() : value;
  const invalid = lines ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/;
  if (!normalized || Array.from(normalized).length > max || invalid.test(normalized)) throw error(code, message);
  return normalized;
}
function optional(value, code, message, options) { return value == null || value === '' ? null : required(value, code, message, options); }
function date(row, name) { return toIsoTimestamp(row[name]); }
function conversation(row) { return row && { id: row.id, ownerUserId: row.owner_user_id, title: row.title, status: row.status, defaultModel: row.default_model, createdAt: date(row, 'created_at'), updatedAt: date(row, 'updated_at') }; }
function job(row) { return row && { id: row.id, conversationId: row.conversation_id, userId: row.user_id, opencodeSessionBindingId: row.opencode_session_binding_id, workerId: row.worker_id, idempotencyKey: row.idempotency_key, inputText: row.input_text, status: row.status, errorCode: row.error_code, createdAt: date(row, 'created_at'), updatedAt: date(row, 'updated_at'), startedAt: date(row, 'started_at'), finishedAt: date(row, 'finished_at') }; }
function worker(row) { return row && { id: row.id, instanceId: row.instance_id, status: row.status, endpoint: row.endpoint, processId: row.process_id == null ? null : Number(row.process_id), version: row.version, capacity: Number(row.capacity), lastHeartbeatAt: date(row, 'last_heartbeat_at'), createdAt: date(row, 'created_at'), updatedAt: date(row, 'updated_at') }; }
function session(row) { return row && { id: row.id, conversationId: row.conversation_id, opencodeSessionId: row.opencode_session_id, workerId: row.worker_id, workspacePath: row.workspace_path, recoveryStatus: row.recovery_status, createdAt: date(row, 'created_at'), updatedAt: date(row, 'updated_at') }; }
function event(row) { return row && { sequence: Number(row.sequence), conversationId: row.conversation_id, jobId: row.job_id, type: row.type, data: typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json, occurredAt: date(row, 'created_at') }; }
function timestamp(clock) { return toMySqlTimestamp(clock()); }
function payload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw error('INVALID_GATEWAY_EVENT', 'gateway event payload is invalid');
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized) > 256 * 1024) throw error('INVALID_GATEWAY_EVENT', 'gateway event payload is too large');
  return serialized;
}

function createMySqlGatewayStore(db, { idFactory = crypto.randomUUID, clock = () => new Date().toISOString() } = {}) {
  if (!db || typeof db.query !== 'function' || typeof db.one !== 'function' || typeof db.many !== 'function' || typeof db.transaction !== 'function') throw new TypeError('MySQL database is required');
  async function owned(executor, id, userId) { return executor.one('SELECT * FROM conversations WHERE id = ? AND owner_user_id = ?', [id, userId]); }
  async function insertEvent(executor, { conversationId, jobId = null, type, payload: body = {}, now = timestamp(clock) }) {
    assertGatewayEventType(type);
    if (!await executor.one('SELECT id FROM conversations WHERE id = ?', [conversationId])) throw error('CONVERSATION_NOT_FOUND', 'conversation was not found');
    if (jobId && !await executor.one('SELECT id FROM gateway_jobs WHERE id = ? AND conversation_id = ?', [jobId, conversationId])) throw error('JOB_NOT_FOUND', 'job was not found');
    const result = await executor.query('INSERT INTO gateway_events (conversation_id, job_id, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)', [conversationId, jobId, type, payload(body), now]);
    return event(await executor.one('SELECT * FROM gateway_events WHERE sequence = ?', [result.insertId]));
  }
  async function createConversation({ ownerUserId, title, defaultModel = null }) {
    const id = required(idFactory(), 'INVALID_CONVERSATION_ID', 'conversation id is invalid');
    const owner = required(ownerUserId, 'INVALID_USER_ID', 'user id is invalid');
    const normalizedTitle = required(title, 'INVALID_CONVERSATION_TITLE', 'conversation title is invalid', { max: 200 });
    const model = optional(defaultModel, 'INVALID_MODEL_ID', 'model id is invalid', { max: 200 }); const now = timestamp(clock);
    try { await db.query('INSERT INTO conversations (id, owner_user_id, title, status, default_model, created_at, updated_at) VALUES (?, ?, ?, \'active\', ?, ?, ?)', [id, owner, normalizedTitle, model, now, now]); }
    catch (cause) { if (cause?.code === 'ER_NO_REFERENCED_ROW_2') throw error('USER_NOT_FOUND', 'user was not found'); throw cause; }
    return conversation(await db.one('SELECT * FROM conversations WHERE id = ?', [id]));
  }
  async function getOwnedConversation({ id, ownerUserId }) { return conversation(await owned(db, id, ownerUserId)); }
  async function createJob({ conversationId, userId, idempotencyKey, inputText }) {
    const conversationIdValue = required(conversationId, 'INVALID_CONVERSATION_ID', 'conversation id is invalid'); const userIdValue = required(userId, 'INVALID_USER_ID', 'user id is invalid');
    const key = required(idempotencyKey, 'INVALID_IDEMPOTENCY_KEY', 'idempotency key is invalid', { max: 200 }); const input = required(inputText, 'INVALID_JOB_INPUT', 'job input is invalid', { max: 100000, lines: true });
    return db.transaction(async (tx) => {
      const target = await owned(tx, conversationIdValue, userIdValue); if (!target) throw error('CONVERSATION_NOT_FOUND', 'conversation was not found'); if (target.status !== 'active') throw error('CONVERSATION_ARCHIVED', 'archived conversation cannot accept jobs');
      const duplicate = await tx.one('SELECT * FROM gateway_jobs WHERE user_id = ? AND idempotency_key = ?', [userIdValue, key]);
      if (duplicate) { if (duplicate.conversation_id !== conversationIdValue || duplicate.input_text !== input) throw error('IDEMPOTENCY_CONFLICT', 'idempotency key was already used'); return { ...job(duplicate), deduplicated: true }; }
      const id = required(idFactory(), 'INVALID_JOB_ID', 'job id is invalid'); const now = timestamp(clock);
      await tx.query('INSERT INTO gateway_jobs (id, conversation_id, user_id, idempotency_key, input_text, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, \'queued\', ?, ?)', [id, conversationIdValue, userIdValue, key, input, now, now]);
      await insertEvent(tx, { conversationId: conversationIdValue, jobId: id, type: GATEWAY_EVENT_TYPES.MESSAGE_CREATED, payload: { role: 'user', text: input }, now });
      await insertEvent(tx, { conversationId: conversationIdValue, jobId: id, type: GATEWAY_EVENT_TYPES.JOB_QUEUED, payload: { status: 'queued' }, now });
      return job(await tx.one('SELECT * FROM gateway_jobs WHERE id = ?', [id]));
    });
  }
  async function getJob({ id, userId } = {}) { const row = await db.one(`SELECT * FROM gateway_jobs WHERE id = ?${userId ? ' AND user_id = ?' : ''}`, userId ? [id, userId] : [id]); return job(row); }
  async function transition({ jobId, userId, event: action, errorCode = null, workerId, bindingId }) {
    return db.transaction(async (tx) => {
      const row = await tx.one(`SELECT * FROM gateway_jobs WHERE id = ?${userId ? ' AND user_id = ?' : ''}`, userId ? [jobId, userId] : [jobId]); if (!row) throw error('JOB_NOT_FOUND', 'job was not found');
      const status = transitionJob(row.status, action); const now = timestamp(clock); const code = optional(errorCode, 'INVALID_JOB_ERROR_CODE', 'job error code is invalid', { max: 100 });
      await tx.query('UPDATE gateway_jobs SET status = ?, error_code = ?, worker_id = ?, opencode_session_binding_id = ?, updated_at = ?, started_at = ?, finished_at = ? WHERE id = ?', [status, code, workerId === undefined ? row.worker_id : workerId, bindingId === undefined ? row.opencode_session_binding_id : bindingId, now, action === 'start' ? now : row.started_at, TERMINAL_JOB_STATUSES.has(status) ? now : row.finished_at, jobId]);
      await insertEvent(tx, { conversationId: row.conversation_id, jobId, type: EVENT_FOR_TRANSITION[action], payload: { status, ...(code ? { errorCode: code } : {}) }, now }); return job(await tx.one('SELECT * FROM gateway_jobs WHERE id = ?', [jobId]));
    });
  }
  async function listEventsAfter({ conversationId, ownerUserId, afterSequence = 0, limit = 500 }) { if (!await owned(db, conversationId, ownerUserId)) return null; if (!Number.isInteger(afterSequence) || afterSequence < 0) throw error('INVALID_EVENT_SEQUENCE', 'event sequence is invalid'); if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw error('INVALID_LIMIT', 'event limit is invalid'); return (await db.many('SELECT * FROM gateway_events WHERE conversation_id = ? AND sequence > ? ORDER BY sequence LIMIT ?', [conversationId, afterSequence, limit])).map(event); }
  async function upsertWorker({ id, instanceId, status, endpoint = null, processId = null, version = null, capacity = 1, lastHeartbeatAt = null }) {
    const workerId = required(id, 'INVALID_WORKER_ID', 'worker id is invalid'); const instance = required(instanceId, 'INVALID_WORKER_INSTANCE', 'worker instance is invalid'); if (!WORKER_STATUSES.has(status)) throw error('INVALID_WORKER_STATUS', 'worker status is invalid'); if (!Number.isInteger(capacity) || capacity < 1 || capacity > 16) throw error('INVALID_WORKER_CAPACITY', 'worker capacity is invalid'); if (processId !== null && (!Number.isInteger(processId) || processId < 1)) throw error('INVALID_WORKER_PROCESS', 'worker process id is invalid'); const now = timestamp(clock);
    await db.query('INSERT INTO gateway_workers (id, instance_id, status, endpoint, process_id, version, capacity, last_heartbeat_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE instance_id = VALUES(instance_id), status = VALUES(status), endpoint = VALUES(endpoint), process_id = VALUES(process_id), version = VALUES(version), capacity = VALUES(capacity), last_heartbeat_at = VALUES(last_heartbeat_at), updated_at = VALUES(updated_at)', [workerId, instance, status, optional(endpoint, 'INVALID_WORKER_ENDPOINT', 'worker endpoint is invalid', { max: 500 }), processId, optional(version, 'INVALID_WORKER_VERSION', 'worker version is invalid', { max: 100 }), capacity, toMySqlTimestamp(lastHeartbeatAt), now, now]); return worker(await db.one('SELECT * FROM gateway_workers WHERE id = ?', [workerId]));
  }
  async function bindOpenCodeSession({ id, conversationId, opencodeSessionId, workerId = null, workspacePath, recoveryStatus = 'active' }) {
    const bindingId = required(id, 'INVALID_SESSION_BINDING_ID', 'session binding id is invalid'); if (!await db.one('SELECT id FROM conversations WHERE id = ?', [conversationId])) throw error('CONVERSATION_NOT_FOUND', 'conversation was not found'); const openCodeId = required(opencodeSessionId, 'INVALID_OPENCODE_SESSION_ID', 'OpenCode session id is invalid', { max: 200 }); const path = required(workspacePath, 'INVALID_WORKSPACE_PATH', 'workspace path is invalid', { max: 4096, trim: false }); if (!RECOVERY_STATUSES.has(recoveryStatus)) throw error('INVALID_RECOVERY_STATUS', 'recovery status is invalid'); const now = timestamp(clock);
    await db.query('INSERT INTO opencode_sessions (id, conversation_id, opencode_session_id, worker_id, workspace_path, workspace_path_sha256, recovery_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, SHA2(?, 256), ?, ?, ?) ON DUPLICATE KEY UPDATE opencode_session_id = VALUES(opencode_session_id), worker_id = VALUES(worker_id), workspace_path = VALUES(workspace_path), workspace_path_sha256 = VALUES(workspace_path_sha256), recovery_status = VALUES(recovery_status), updated_at = VALUES(updated_at)', [bindingId, conversationId, openCodeId, workerId, path, path, recoveryStatus, now, now]); return session(await db.one('SELECT * FROM opencode_sessions WHERE conversation_id = ?', [conversationId]));
  }
  async function recoverOnStartup() { return db.transaction(async (tx) => { const now = timestamp(clock); const running = await tx.many("SELECT * FROM gateway_jobs WHERE status = 'running' ORDER BY created_at, id"); for (const row of running) { await tx.query("UPDATE gateway_jobs SET status = 'interrupted', error_code = 'GATEWAY_RESTARTED', updated_at = ?, finished_at = ? WHERE id = ?", [now, now, row.id]); await insertEvent(tx, { conversationId: row.conversation_id, jobId: row.id, type: GATEWAY_EVENT_TYPES.JOB_INTERRUPTED, payload: { status: 'interrupted', errorCode: 'GATEWAY_RESTARTED' }, now }); } const sessions = await tx.query("UPDATE opencode_sessions SET recovery_status = 'recovering', updated_at = ? WHERE recovery_status = 'active'", [now]); const workers = await tx.query("UPDATE gateway_workers SET status = 'stopped', process_id = NULL, updated_at = ? WHERE status != 'stopped'", [now]); return { interruptedJobs: running.length, recoveringSessions: Number(sessions.affectedRows), stoppedWorkers: Number(workers.affectedRows) }; }); }
  async function getJobByIdempotency({ userId, idempotencyKey }) {
    return job(await db.one('SELECT * FROM gateway_jobs WHERE user_id = ? AND idempotency_key = ?', [userId, idempotencyKey]));
  }
  return Object.freeze({ appendEvent: (input) => db.transaction((tx) => insertEvent(tx, input)), bindOpenCodeSession, createConversation, createJob, getJob, getJobByIdempotency, getOpenCodeSession: async ({ conversationId }) => session(await db.one('SELECT * FROM opencode_sessions WHERE conversation_id = ?', [conversationId])), getOwnedConversation, listEventsAfter, recoverOnStartup, transitionJob: transition, upsertWorker });
}

module.exports = { createMySqlGatewayStore };
