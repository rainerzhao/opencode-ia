'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { parseSseStream } = require('./sse-parser');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);

function clientError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function requiredString(value, code, message, max = 4096) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) {
    throw clientError(code, message);
  }
  return value;
}

function normalizeEndpoint(value) {
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    throw clientError('OPENCODE_ENDPOINT_UNSAFE', 'OpenCode endpoint is invalid');
  }
  if (
    endpoint.protocol !== 'http:' ||
    !LOOPBACK_HOSTS.has(endpoint.hostname) ||
    endpoint.username ||
    endpoint.password ||
    (endpoint.pathname !== '/' && endpoint.pathname !== '') ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw clientError('OPENCODE_ENDPOINT_UNSAFE', 'OpenCode endpoint must be a loopback HTTP origin');
  }
  return endpoint.origin;
}

function normalizeDirectory(value) {
  const directory = requiredString(
    value,
    'INVALID_OPENCODE_DIRECTORY',
    'OpenCode directory is invalid'
  );
  if (!path.isAbsolute(directory) || directory.includes('\0')) {
    throw clientError('INVALID_OPENCODE_DIRECTORY', 'OpenCode directory is invalid');
  }
  return directory;
}

function normalizeToolFlags(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw clientError('INVALID_OPENCODE_TOOLS', 'OpenCode tool flags are invalid');
  }
  const entries = Object.entries(value);
  if (entries.length < 1 || entries.length > 64 || entries.some(([name, enabled]) =>
    !/^[A-Za-z0-9_.:-]{1,100}$/.test(name) || typeof enabled !== 'boolean'
  )) {
    throw clientError('INVALID_OPENCODE_TOOLS', 'OpenCode tool flags are invalid');
  }
  return Object.fromEntries(entries);
}

function abortableDelay(milliseconds, signal) {
  if (signal.aborted) {
    return Promise.reject(clientError('OPENCODE_ABORTED', 'OpenCode request was cancelled'));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      reject(clientError('OPENCODE_ABORTED', 'OpenCode request was cancelled'));
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    timeout.unref();
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function createOpenCodeClient({
  endpoint,
  username,
  password,
  expectedVersion = null,
  requestTimeoutMs = 10_000,
  promptTimeoutMs = requestTimeoutMs,
  promptPollIntervalMs = 100,
  healthTimeoutMs = requestTimeoutMs,
  maxEventBytes = 256 * 1024,
  messageIdFactory = () => `msg_${crypto.randomUUID().replaceAll('-', '')}`,
  fetchImpl = fetch
}) {
  const origin = normalizeEndpoint(endpoint);
  const authUsername = requiredString(
    username,
    'INVALID_OPENCODE_CREDENTIALS',
    'OpenCode credentials are invalid',
    200
  );
  const authPassword = requiredString(
    password,
    'INVALID_OPENCODE_CREDENTIALS',
    'OpenCode credentials are invalid',
    1024
  );
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1) {
    throw new TypeError('OpenCode request timeout is invalid');
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('OpenCode fetch implementation is required');
  const authorization = `Basic ${Buffer.from(`${authUsername}:${authPassword}`).toString('base64')}`;

  function target(pathname, directory) {
    const url = new URL(pathname, origin);
    if (url.origin !== origin) {
      throw clientError('OPENCODE_ENDPOINT_UNSAFE', 'OpenCode request path is invalid');
    }
    if (directory !== undefined) url.searchParams.set('directory', normalizeDirectory(directory));
    return url;
  }

  if (!Number.isInteger(promptTimeoutMs) || promptTimeoutMs < 1) throw new TypeError('OpenCode prompt timeout is invalid');
  if (!Number.isInteger(promptPollIntervalMs) || promptPollIntervalMs < 1) {
    throw new TypeError('OpenCode prompt poll interval is invalid');
  }
  if (!Number.isInteger(healthTimeoutMs) || healthTimeoutMs < 1) throw new TypeError('OpenCode health timeout is invalid');
  if (typeof messageIdFactory !== 'function') throw new TypeError('OpenCode message id factory is invalid');

  async function withDeadline(callerSignal, action, timeoutMs = requestTimeoutMs) {
    if (callerSignal?.aborted) {
      throw clientError('OPENCODE_ABORTED', 'OpenCode request was cancelled');
    }
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
    timeout.unref();
    const signals = [timeoutController.signal, ...(callerSignal ? [callerSignal] : [])];
    try {
      return await action(AbortSignal.any(signals));
    } catch (error) {
      if (callerSignal?.aborted) {
        throw clientError('OPENCODE_ABORTED', 'OpenCode request was cancelled');
      }
      if (timeoutController.signal.aborted) {
        throw clientError('OPENCODE_TIMEOUT', 'OpenCode request timed out');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function authenticatedFetch(url, options = {}) {
    try {
      return await fetchImpl(url, {
        ...options,
        headers: {
          authorization,
          accept: 'application/json',
          ...options.headers
        }
      });
    } catch {
      throw clientError('OPENCODE_UNAVAILABLE', 'OpenCode worker is unavailable');
    }
  }

  async function requestJson(pathname, {
    method = 'GET',
    body,
    signal,
    directory,
    timeoutMs = requestTimeoutMs
  } = {}) {
    return withDeadline(signal, async (deadlineSignal) => {
      const response = await authenticatedFetch(target(pathname, directory), {
        method,
        signal: deadlineSignal,
        ...(body === undefined ? {} : {
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' }
        })
      });
      if (!response.ok) {
        throw clientError(
          'OPENCODE_API_ERROR',
          'OpenCode worker rejected the request',
          { status: response.status }
        );
      }
      if (response.status === 204) return null;
      try {
        return await response.json();
      } catch (error) {
        if (deadlineSignal.aborted) throw error;
        throw clientError('OPENCODE_PROTOCOL_ERROR', 'OpenCode worker returned an invalid response');
      }
    }, timeoutMs);
  }

  async function health({ signal } = {}) {
    const result = await requestJson('/global/health', { signal, timeoutMs: healthTimeoutMs });
    if (!result || result.healthy !== true || typeof result.version !== 'string') {
      throw clientError('OPENCODE_PROTOCOL_ERROR', 'OpenCode health response is invalid');
    }
    if (expectedVersion && result.version !== expectedVersion) {
      throw clientError(
        'OPENCODE_VERSION_MISMATCH',
        'OpenCode worker version does not match the verified version',
        { actualVersion: result.version, expectedVersion }
      );
    }
    return { healthy: true, version: result.version };
  }

  function createSession({ directory, title, agent, model, permission, signal } = {}) {
    const body = {};
    if (title !== undefined) body.title = requiredString(
      title,
      'INVALID_OPENCODE_SESSION',
      'OpenCode session title is invalid',
      200
    );
    if (agent !== undefined) body.agent = requiredString(
      agent,
      'INVALID_OPENCODE_SESSION',
      'OpenCode agent is invalid',
      200
    );
    if (model !== undefined) body.model = model;
    if (permission !== undefined) body.permission = permission;
    return requestJson('/session', { method: 'POST', body, directory, signal });
  }

  function getSession({ sessionId, directory, signal } = {}) {
    const id = requiredString(
      sessionId,
      'INVALID_OPENCODE_SESSION',
      'OpenCode session id is invalid',
      200
    );
    return requestJson(`/session/${encodeURIComponent(id)}`, { directory, signal });
  }

  async function prompt({ sessionId, directory, text, model, agent, tools, signal } = {}) {
    const id = requiredString(
      sessionId,
      'INVALID_OPENCODE_SESSION',
      'OpenCode session id is invalid',
      200
    );
    const promptText = requiredString(
      text,
      'INVALID_OPENCODE_PROMPT',
      'OpenCode prompt is invalid',
      100000
    );
    const messageId = requiredString(
      messageIdFactory(),
      'INVALID_OPENCODE_MESSAGE_ID',
      'OpenCode message id is invalid',
      200
    );
    if (!/^msg[A-Za-z0-9_-]*$/.test(messageId)) {
      throw clientError('INVALID_OPENCODE_MESSAGE_ID', 'OpenCode message id is invalid');
    }
    const body = {
      messageID: messageId,
      parts: [{ type: 'text', text: promptText }]
    };
    if (model !== undefined) body.model = model;
    if (agent !== undefined) body.agent = agent;
    if (tools !== undefined) body.tools = normalizeToolFlags(tools);
    return withDeadline(signal, async (deadlineSignal) => {
      await requestJson(`/session/${encodeURIComponent(id)}/prompt_async`, {
        method: 'POST',
        body,
        directory,
        signal: deadlineSignal
      });
      while (true) {
        const messages = await requestJson(
          `/session/${encodeURIComponent(id)}/message?limit=100`,
          { directory, signal: deadlineSignal }
        );
        if (!Array.isArray(messages)) {
          throw clientError('OPENCODE_PROTOCOL_ERROR', 'OpenCode worker returned invalid session messages');
        }
        const result = messages.find((message) =>
          message?.info?.role === 'assistant' && message.info.parentID === messageId
        );
        if (result?.info?.error) {
          throw clientError('OPENCODE_MODEL_ERROR', 'OpenCode model execution failed');
        }
        if (result?.info?.time?.completed) return result;
        await abortableDelay(promptPollIntervalMs, deadlineSignal);
      }
    }, promptTimeoutMs);
  }

  function abortSession({ sessionId, directory, signal } = {}) {
    const id = requiredString(
      sessionId,
      'INVALID_OPENCODE_SESSION',
      'OpenCode session id is invalid',
      200
    );
    return requestJson(`/session/${encodeURIComponent(id)}/abort`, {
      method: 'POST',
      body: {},
      directory,
      signal
    });
  }

  async function subscribeEvents({ directory, onEvent, signal } = {}) {
    if (typeof onEvent !== 'function') throw new TypeError('OpenCode event callback is required');
    const response = await withDeadline(signal, (deadlineSignal) => authenticatedFetch(
      target('/event', directory),
      {
        method: 'GET',
        signal: deadlineSignal,
        headers: { accept: 'text/event-stream' }
      }
    ));
    if (!response.ok || !response.body) {
      throw clientError(
        'OPENCODE_API_ERROR',
        'OpenCode worker rejected the event subscription',
        { status: response.status }
      );
    }
    return parseSseStream(response.body, onEvent, signal, { maxEventBytes });
  }

  return {
    abortSession,
    createSession,
    getSession,
    health,
    prompt,
    requestJson,
    subscribeEvents
  };
}

module.exports = { createOpenCodeClient };
