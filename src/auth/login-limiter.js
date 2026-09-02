'use strict';

function normalizeAttempt({ username, sourceIp }) {
  return {
    username: typeof username === 'string' ? username.trim().toLowerCase() : '',
    sourceIp: typeof sourceIp === 'string' && sourceIp ? sourceIp : 'unknown'
  };
}

function createLoginLimiter({
  maxFailures = 5,
  windowMs = 15 * 60 * 1000,
  lockMs = 15 * 60 * 1000,
  maxEntries = 10_000,
  now = Date.now
} = {}) {
  if (!Number.isInteger(maxFailures) || maxFailures < 1) throw new TypeError('maxFailures is invalid');
  if (!Number.isInteger(windowMs) || windowMs < 1) throw new TypeError('windowMs is invalid');
  if (!Number.isInteger(lockMs) || lockMs < 1) throw new TypeError('lockMs is invalid');
  if (!Number.isInteger(maxEntries) || maxEntries < 2) throw new TypeError('maxEntries is invalid');

  const entries = new Map();

  function keys(attempt) {
    const normalized = normalizeAttempt(attempt);
    return [`username:${normalized.username}`, `ip:${normalized.sourceIp}`];
  }

  function cleanupRecord(key, timestamp) {
    const record = entries.get(key);
    if (!record) return null;
    record.failures = record.failures.filter((failure) => failure > timestamp - windowMs);
    if (record.lockedUntil <= timestamp && record.failures.length === 0) {
      entries.delete(key);
      return null;
    }
    return record;
  }

  function prune() {
    const timestamp = now();
    for (const key of entries.keys()) cleanupRecord(key, timestamp);
    while (entries.size > maxEntries) {
      let oldestKey;
      let oldestTimestamp = Infinity;
      for (const [key, record] of entries) {
        if (record.updatedAt < oldestTimestamp) {
          oldestKey = key;
          oldestTimestamp = record.updatedAt;
        }
      }
      if (oldestKey === undefined) break;
      entries.delete(oldestKey);
    }
  }

  function check(attempt) {
    const timestamp = now();
    let lockedUntil = 0;
    for (const key of keys(attempt)) {
      const record = cleanupRecord(key, timestamp);
      if (record?.lockedUntil > lockedUntil) lockedUntil = record.lockedUntil;
    }
    return lockedUntil > timestamp
      ? { allowed: false, retryAfterSeconds: Math.ceil((lockedUntil - timestamp) / 1000) }
      : { allowed: true, retryAfterSeconds: 0 };
  }

  function recordFailure(attempt) {
    const timestamp = now();
    for (const key of keys(attempt)) {
      const record = cleanupRecord(key, timestamp) || {
        failures: [],
        lockedUntil: 0,
        updatedAt: timestamp
      };
      record.failures.push(timestamp);
      record.updatedAt = timestamp;
      if (record.failures.length >= maxFailures) record.lockedUntil = timestamp + lockMs;
      entries.set(key, record);
    }
    prune();
  }

  function recordSuccess(attempt) {
    const normalized = normalizeAttempt(attempt);
    entries.delete(`username:${normalized.username}`);
  }

  return { check, recordFailure, recordSuccess, prune, size: () => entries.size };
}

module.exports = { createLoginLimiter };
