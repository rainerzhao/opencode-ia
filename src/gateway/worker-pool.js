'use strict';

function poolError(code, message) {
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

function withTimeout(promise, milliseconds) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(
        () => reject(poolError('WORKER_HEARTBEAT_TIMEOUT', 'worker heartbeat timed out')),
        milliseconds
      );
      timeout.unref();
    })
  ]).finally(() => clearTimeout(timeout));
}

function createWorkerPool({
  workerCount,
  workerFactory,
  heartbeatMs = 5_000,
  heartbeatTimeoutMs = 2_000,
  onWorkerExit = () => {},
  onWorkerStatus = () => {}
}) {
  positiveInteger(workerCount, 'worker count');
  positiveInteger(heartbeatMs, 'worker heartbeat interval');
  positiveInteger(heartbeatTimeoutMs, 'worker heartbeat timeout');
  if (typeof workerFactory !== 'function') throw new TypeError('worker factory is required');
  if (typeof onWorkerExit !== 'function' || typeof onWorkerStatus !== 'function') {
    throw new TypeError('worker pool callbacks are invalid');
  }

  const slots = [];
  const stickyWorkers = new Map();
  const exitListeners = new Set([onWorkerExit]);
  const statusListeners = new Set([onWorkerStatus]);
  let status = 'stopped';
  let timer = null;
  let nextLeaseId = 0;
  let nextSlot = 0;
  let heartbeatPromise = null;

  function publicWorker(slot) {
    const process = slot.worker?.snapshot?.() || {};
    return {
      id: slot.id,
      instanceId: slot.instanceId,
      status: slot.status,
      endpoint: process.endpoint || null,
      processId: process.processId || null,
      version: process.version || null,
      capacity: 1,
      running: slot.leases.size
    };
  }

  function publish(slot) {
    const worker = publicWorker(slot);
    for (const listener of statusListeners) {
      try { listener(worker); } catch {}
    }
  }

  function markUnhealthy(workerId, reason = 'WORKER_UNAVAILABLE') {
    const slot = slots.find((candidate) => candidate.id === workerId);
    if (!slot) throw poolError('WORKER_NOT_FOUND', 'worker was not found');
    const leases = [...slot.leases.values()];
    slot.leases.clear();
    slot.status = 'unhealthy';
    publish(slot);
    return { workerId, reason, leases };
  }

  function handleExit(slot, exit) {
    if (exit?.expected || status === 'stopping' || status === 'stopped') return;
    const affected = markUnhealthy(slot.id, 'WORKER_EXITED');
    for (const listener of exitListeners) {
      try { listener({ ...affected, exit }); } catch {}
    }
  }

  async function startSlot(slot) {
    const result = await slot.worker.start();
    slot.status = result?.status === 'healthy' ? 'healthy' : 'unhealthy';
    publish(slot);
    if (slot.status !== 'healthy') {
      throw poolError('WORKER_START_FAILED', 'worker did not become healthy');
    }
  }

  async function start() {
    if (status === 'running') return snapshot();
    if (status === 'starting') throw poolError('WORKER_POOL_STARTING', 'worker pool is starting');
    status = 'starting';
    if (slots.length === 0) {
      for (let index = 0; index < workerCount; index += 1) {
        const slot = {
          id: `worker-${index + 1}`,
          instanceId: `${process.pid}-worker-${index + 1}`,
          index,
          status: 'stopped',
          worker: null,
          leases: new Map()
        };
        slot.worker = workerFactory({
          id: slot.id,
          index,
          onExit: (exit) => handleExit(slot, exit)
        });
        if (!slot.worker || typeof slot.worker.start !== 'function' ||
            typeof slot.worker.stop !== 'function' || typeof slot.worker.health !== 'function') {
          status = 'stopped';
          throw new TypeError('worker factory returned an invalid worker');
        }
        slots.push(slot);
      }
    }
    try {
      await Promise.all(slots.map(startSlot));
      status = 'running';
      timer = setInterval(() => { heartbeat().catch(() => {}); }, heartbeatMs);
      timer.unref();
      return snapshot();
    } catch (error) {
      await Promise.allSettled(slots.map((slot) => slot.worker.stop()));
      for (const slot of slots) slot.status = 'stopped';
      status = 'stopped';
      throw error;
    }
  }

  function acquire({ conversationId, preferredWorkerId } = {}) {
    if (status !== 'running') return null;
    const conversation = requiredString(conversationId, 'conversation id');
    if (preferredWorkerId !== undefined) requiredString(preferredWorkerId, 'preferred worker id');
    const stickyId = preferredWorkerId || stickyWorkers.get(conversation);
    if (stickyId) {
      const sticky = slots.find((slot) => slot.id === stickyId);
      if (!sticky || sticky.status !== 'healthy' || sticky.leases.size >= 1) return null;
      return lease(sticky, conversation);
    }
    for (let offset = 0; offset < slots.length; offset += 1) {
      const index = (nextSlot + offset) % slots.length;
      const slot = slots[index];
      if (slot.status !== 'healthy' || slot.leases.size >= 1) continue;
      nextSlot = (index + 1) % slots.length;
      stickyWorkers.set(conversation, slot.id);
      return lease(slot, conversation);
    }
    return null;
  }

  function lease(slot, conversationId) {
    const token = `lease-${++nextLeaseId}`;
    const value = Object.freeze({
      token,
      workerId: slot.id,
      conversationId,
      worker: slot.worker,
      client: slot.worker.client
    });
    slot.leases.set(token, value);
    publish(slot);
    return value;
  }

  function release(value) {
    if (!value || typeof value.token !== 'string' || typeof value.workerId !== 'string') return false;
    const slot = slots.find((candidate) => candidate.id === value.workerId);
    const removed = slot?.leases.delete(value.token) || false;
    if (removed) publish(slot);
    return removed;
  }

  async function runHeartbeat() {
    if (status !== 'running') return snapshot();
    for (const slot of slots) {
      if (status !== 'running') break;
      if (slot.status === 'healthy') {
        try {
          await withTimeout(Promise.resolve(slot.worker.health()), heartbeatTimeoutMs);
          publish(slot);
        } catch (error) {
          const affected = markUnhealthy(slot.id, error.code || 'WORKER_HEARTBEAT_FAILED');
          if (affected.leases.length > 0) {
            for (const listener of exitListeners) {
              try { listener({ ...affected, exit: null }); } catch {}
            }
          }
        }
      } else if (slot.status === 'unhealthy') {
        try { await startSlot(slot); } catch {}
      }
    }
    return snapshot();
  }

  function heartbeat() {
    if (!heartbeatPromise) {
      heartbeatPromise = runHeartbeat().finally(() => { heartbeatPromise = null; });
    }
    return heartbeatPromise;
  }

  async function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    if (status === 'stopped') return snapshot();
    status = 'stopping';
    if (heartbeatPromise) await heartbeatPromise.catch(() => {});
    await Promise.allSettled(slots.map(async (slot) => {
      slot.leases.clear();
      await slot.worker.stop();
      slot.status = 'stopped';
      publish(slot);
    }));
    stickyWorkers.clear();
    status = 'stopped';
    return snapshot();
  }

  function snapshot() {
    return { status, workers: slots.map(publicWorker) };
  }

  function subscribeExits(listener) {
    if (typeof listener !== 'function') throw new TypeError('worker exit listener is invalid');
    exitListeners.add(listener);
    return () => exitListeners.delete(listener);
  }

  function subscribeStatuses(listener) {
    if (typeof listener !== 'function') throw new TypeError('worker status listener is invalid');
    statusListeners.add(listener);
    for (const slot of slots) listener(publicWorker(slot));
    return () => statusListeners.delete(listener);
  }

  return {
    acquire,
    heartbeat,
    markUnhealthy,
    release,
    snapshot,
    start,
    stop,
    subscribeExits,
    subscribeStatuses
  };
}

module.exports = { createWorkerPool };
