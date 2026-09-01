'use strict';

const crypto = require('node:crypto');

function toAuditEvent(row) {
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    metadata: JSON.parse(row.metadata_json),
    sourceIp: row.source_ip,
    createdAt: row.created_at
  };
}

function createAuditStore(db, { idFactory = crypto.randomUUID } = {}) {
  const insertStatement = db.prepare(`
    INSERT INTO audit_logs (
      id, actor_user_id, action, target_type, target_id, metadata_json, source_ip, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const listStatement = db.prepare(`
    SELECT * FROM audit_logs
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `);

  function append({ actorUserId = null, action, targetType, targetId = null, metadata = {}, sourceIp = null, now }) {
    if (typeof action !== 'string' || action === '') throw new TypeError('audit action is required');
    if (typeof targetType !== 'string' || targetType === '') throw new TypeError('audit target type is required');
    if (typeof now !== 'string' || now === '') throw new TypeError('audit timestamp is required');
    const metadataJson = JSON.stringify(metadata);
    if (metadataJson.length > 16 * 1024) throw new TypeError('audit metadata is too large');

    const id = idFactory();
    insertStatement.run(
      id,
      actorUserId,
      action,
      targetType,
      targetId,
      metadataJson,
      sourceIp,
      now
    );
    return toAuditEvent(db.prepare('SELECT * FROM audit_logs WHERE id = ?').get(id));
  }

  function list({ limit = 100 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new TypeError('audit limit is invalid');
    }
    return listStatement.all(limit).map(toAuditEvent);
  }

  return { append, list };
}

module.exports = { createAuditStore };
