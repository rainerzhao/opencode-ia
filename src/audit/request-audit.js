'use strict';

const { createAuditStore } = require('./audit-store');

function safeSourceIp(req) {
  const value = req.socket?.remoteAddress;
  return typeof value === 'string' ? value.slice(0, 128) : null;
}

function createRequestAuditor({ db, auditStore: providedAuditStore = null, clock = () => new Date() }) {
  const auditStore = providedAuditStore || (db && createAuditStore(db));
  if (!auditStore || typeof auditStore.append !== 'function') throw new TypeError('audit store is required');

  function record(req, { action, targetType, targetId = null, metadata = {} }) {
    if (!req?.auth?.user?.id) throw new TypeError('authenticated request is required');
    const now = clock();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
      throw new TypeError('clock returned an invalid date');
    }
    return auditStore.append({
      actorUserId: req.auth.user.id,
      action,
      targetType,
      targetId,
      metadata: { ...metadata, requestId: req.requestId },
      sourceIp: safeSourceIp(req),
      now: now.toISOString()
    });
  }

  return { record };
}

module.exports = { createRequestAuditor, safeSourceIp };
