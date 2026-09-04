'use strict';

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

function createOpenCodeClient({
  endpoint,
  username,
  password,
  expectedVersion = null,
  requestTimeoutMs = 10_000,
  maxEventBytes = 256 * 1024,
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

  async function withDeadline(callerSignal, action) {
    if (callerSignal?.aborted) {
      throw clientError('OPENCODE_ABORTED', 'OpenCode request was cancelled');
    }
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), requestTimeoutMs);
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
    directory
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
      try {
        return await response.json();
      } catch (error) {
        if (deadlineSignal.aborted) throw error;
        throw clientError('OPENCODE_PROTOCOL_ERROR', 'OpenCode worker returned an invalid response');
      }
    });
  }

  async function health({ signal } = {}) {
    const result = await requestJson('/global/health', { signal });
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

  function prompt({ sessionId, directory, text, model, agent, signal } = {}) {
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
    const body = { parts: [{ type: 'text', text: promptText }] };
    if (model !== undefined) body.model = model;
    if (agent !== undefined) body.agent = agent;
    return requestJson(`/session/${encodeURIComponent(id)}/message`, {
      method: 'POST',
      body,
      directory,
      signal
    });
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
