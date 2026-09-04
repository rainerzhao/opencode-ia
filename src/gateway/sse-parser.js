'use strict';

const { StringDecoder } = require('node:string_decoder');

function streamError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function parseSseStream(readable, onEvent, signal, { maxEventBytes = 256 * 1024 } = {}) {
  if (!readable || typeof readable.getReader !== 'function') {
    throw new TypeError('SSE readable stream is required');
  }
  if (typeof onEvent !== 'function') throw new TypeError('SSE event callback is required');
  if (!Number.isInteger(maxEventBytes) || maxEventBytes < 1) {
    throw new TypeError('SSE event byte limit is invalid');
  }

  const reader = readable.getReader();
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  let dataLines = [];
  let eventBytes = 0;
  let aborted = signal?.aborted === true;

  const abortError = () => streamError(
    'OPENCODE_EVENT_STREAM_ABORTED',
    'OpenCode event stream was cancelled'
  );
  const onAbort = () => {
    aborted = true;
    reader.cancel().catch(() => {});
  };
  if (signal) signal.addEventListener('abort', onAbort, { once: true });

  function resetEvent() {
    dataLines = [];
    eventBytes = 0;
  }

  function dispatchEvent() {
    if (dataLines.length === 0) return;
    const data = dataLines.join('\n');
    resetEvent();
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch (error) {
      if (error instanceof SyntaxError) return;
      throw error;
    }
    onEvent(parsed);
    if (aborted) throw abortError();
  }

  function consumeLine(rawLine) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line === '') {
      dispatchEvent();
      return;
    }
    if (line.startsWith(':')) return;
    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field !== 'data') return;
    eventBytes += Buffer.byteLength(value, 'utf8');
    if (eventBytes > maxEventBytes) {
      throw streamError('OPENCODE_EVENT_LIMIT', 'OpenCode event exceeded the byte limit');
    }
    dataLines.push(value);
  }

  try {
    if (aborted) throw abortError();
    while (true) {
      const { done, value } = await reader.read();
      if (aborted) throw abortError();
      if (done) break;
      buffer += decoder.write(Buffer.from(value));
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) consumeLine(line);
    }
    buffer += decoder.end();
    if (buffer !== '') consumeLine(buffer);
    dispatchEvent();
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort);
    try { reader.releaseLock(); } catch {}
  }
}

module.exports = { parseSseStream };
