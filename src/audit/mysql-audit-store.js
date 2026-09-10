'use strict';

const crypto = require('node:crypto');
const { toIsoTimestamp, toMySqlTimestamp } = require('../users/mysql-user-store');

function toAuditEvent(row) {
  if (!row) return null;
  return {
    id: row.id, actorUserId: row.actor_user_id, action: row.action, targetType: row.target_type,
    targetId: row.target_id, metadata: typeof row.metadata_json === 'string' ? JSON.parse(row.metadata_json) : row.metadata_json,
    sourceIp: row.source_ip, createdAt: toIsoTimestamp(row.created_at)
  };
}

function createMySqlAuditStore(db, { idFactory = crypto.randomUUID } = {}) {
  if (!db || typeof db.query !== 'function' || typeof db.one !== 'function' || typeof db.many !== 'function') {
    throw new TypeError('MySQL database is required');
  }

  async function append({ actorUserId = null, action, targetType, targetId = null, metadata = {}, sourceIp = null, now }) {
    if (typeof action !== 'string' || action === '') throw new TypeError('audit action is required');
    if (typeof targetType !== 'string' || targetType === '') throw new TypeError('audit target type is required');
    if (typeof now !== 'string' || now === '') throw new TypeError('audit timestamp is required');
    const metadataJson = JSON.stringify(metadata);
    if (metadataJson.length > 16 * 1024) throw new TypeError('audit metadata is too large');
    const id = idFactory();
    await db.query(`
      INSERT INTO audit_logs (id, actor_user_id, action, target_type, target_id, metadata_json, source_ip, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, actorUserId, action, targetType, targetId, metadataJson, sourceIp, toMySqlTimestamp(now)]);
    return toAuditEvent(await db.one('SELECT * FROM audit_logs WHERE id = ?', [id]));
  }

  async function list({ limit = 100 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new TypeError('audit limit is invalid');
    return (await db.many('SELECT * FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT ?', [limit])).map(toAuditEvent);
  }

  return { append, list };
}

module.exports = { createMySqlAuditStore };
