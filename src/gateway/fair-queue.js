'use strict';

function queueError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requiredString(value, name) {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\0')) {
    throw new TypeError(`${name} is invalid`);
  }
  return value;
}

function createFairQueue({ maxQueuedPerUser }) {
  if (!Number.isInteger(maxQueuedPerUser) || maxQueuedPerUser < 1) {
    throw new TypeError('maximum queued jobs per user is invalid');
  }

  const queues = new Map();
  const ring = [];
  const jobIds = new Set();
  let totalQueued = 0;

  function canEnqueue(userId) {
    const user = requiredString(userId, 'queued job user');
    return (queues.get(user)?.length || 0) < maxQueuedPerUser;
  }

  function enqueue(item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new TypeError('queued job is invalid');
    }
    const id = requiredString(item.id, 'queued job id');
    const userId = requiredString(item.userId, 'queued job user');
    requiredString(item.conversationId, 'queued job conversation');
    if (jobIds.has(id)) throw queueError('DUPLICATE_QUEUED_JOB', 'job is already queued');

    let userQueue = queues.get(userId);
    if (!userQueue) {
      userQueue = [];
      queues.set(userId, userQueue);
      ring.push(userId);
    }
    if (userQueue.length >= maxQueuedPerUser) {
      if (userQueue.length === 0) queues.delete(userId);
      throw queueError('USER_QUEUE_LIMIT', 'user queue limit reached');
    }
    userQueue.push(item);
    jobIds.add(id);
    totalQueued += 1;
    return item;
  }

  function nextEligible(predicate = () => true) {
    if (typeof predicate !== 'function') throw new TypeError('queue eligibility check is invalid');
    const usersToInspect = ring.length;
    for (let index = 0; index < usersToInspect; index += 1) {
      const userId = ring.shift();
      const userQueue = queues.get(userId);
      if (!userQueue || userQueue.length === 0) {
        queues.delete(userId);
        continue;
      }
      const item = userQueue[0];
      if (!predicate(item)) {
        ring.push(userId);
        continue;
      }
      userQueue.shift();
      jobIds.delete(item.id);
      totalQueued -= 1;
      if (userQueue.length > 0) ring.push(userId);
      else queues.delete(userId);
      return item;
    }
    return null;
  }

  function remove(jobId) {
    const id = requiredString(jobId, 'queued job id');
    if (!jobIds.has(id)) return null;
    for (const [userId, userQueue] of queues) {
      const index = userQueue.findIndex((item) => item.id === id);
      if (index === -1) continue;
      const [item] = userQueue.splice(index, 1);
      jobIds.delete(id);
      totalQueued -= 1;
      if (userQueue.length === 0) {
        queues.delete(userId);
        const ringIndex = ring.indexOf(userId);
        if (ringIndex !== -1) ring.splice(ringIndex, 1);
      }
      return item;
    }
    return null;
  }

  function snapshot() {
    return {
      totalQueued,
      users: ring.map((userId) => ({ userId, queued: queues.get(userId).length }))
    };
  }

  return { canEnqueue, enqueue, nextEligible, remove, snapshot };
}

module.exports = { createFairQueue };
