'use strict';

const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');

const ERROR_MESSAGES = Object.freeze({
  OPENCODE_TIMEOUT: 'OpenCode request timed out',
  OPENCODE_ABORTED: 'OpenCode request was cancelled',
  OPENCODE_OUTPUT_LIMIT: 'OpenCode response exceeded the output limit',
  OPENCODE_EXIT_ERROR: 'OpenCode process exited unsuccessfully',
  OPENCODE_EMPTY_RESPONSE: 'OpenCode returned no text response',
  OPENCODE_SPAWN_ERROR: 'OpenCode process could not be started'
});

function promptError(code) {
  const error = new Error(ERROR_MESSAGES[code]);
  error.code = code;
  return error;
}

function createPromptRunner(options) {
  const {
    command,
    baseArgs = [],
    cwd,
    env = process.env,
    timeoutMs,
    maxOutputBytes,
    killGraceMs = 250
  } = options;

  async function runPrompt(input, runOptions = {}) {
    const { onEvent } = runOptions;

    return new Promise((resolve, reject) => {
      const child = spawn(
        command,
        [...baseArgs, 'run', '--format', 'json', '--', input],
        { cwd, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] }
      );
      const events = [];
      let text = '';
      let stderr = '';
      let stdoutBuffer = '';
      let outputBytes = 0;
      let requestedError = null;
      let settled = false;
      let terminationStarted = false;
      let forceKillTimer = null;
      const stdoutDecoder = new StringDecoder('utf8');
      const stderrDecoder = new StringDecoder('utf8');

      const signal = runOptions.signal;

      function terminate() {
        if (terminationStarted || child.exitCode !== null || child.signalCode !== null) return;
        terminationStarted = true;
        child.kill('SIGTERM');
        forceKillTimer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        }, killGraceMs);
        forceKillTimer.unref();
      }

      function requestFailure(code) {
        if (requestedError || settled) return;
        requestedError = promptError(code);
        terminate();
      }

      function countOutput(chunk) {
        outputBytes += chunk.length;
        if (outputBytes > maxOutputBytes) {
          requestFailure('OPENCODE_OUTPUT_LIMIT');
          return false;
        }
        return true;
      }

      function consumeLine(line) {
        if (!line.trim()) return;
        try {
          const event = JSON.parse(line);
          events.push(event);
          if (event.type === 'text' && event.part && typeof event.part.text === 'string') {
            text += event.part.text;
          }
          if (onEvent) onEvent(event);
        } catch {
          // OpenCode can emit non-JSON informational lines; they are not events.
        }
      }

      child.stdout.on('data', (chunk) => {
        if (!countOutput(chunk)) return;
        stdoutBuffer += stdoutDecoder.write(chunk);
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop();
        for (const line of lines) consumeLine(line);
      });

      child.stderr.on('data', (chunk) => {
        if (!countOutput(chunk)) return;
        stderr += stderrDecoder.write(chunk);
      });

      const onAbort = () => requestFailure('OPENCODE_ABORTED');
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }

      const timeout = setTimeout(() => requestFailure('OPENCODE_TIMEOUT'), timeoutMs);
      timeout.unref();

      child.once('error', () => requestFailure('OPENCODE_SPAWN_ERROR'));
      child.once('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (forceKillTimer) clearTimeout(forceKillTimer);
        if (signal) signal.removeEventListener('abort', onAbort);

        stdoutBuffer += stdoutDecoder.end();
        stderr += stderrDecoder.end();
        consumeLine(stdoutBuffer);

        if (requestedError) {
          reject(requestedError);
        } else if (code !== 0) {
          reject(promptError('OPENCODE_EXIT_ERROR'));
        } else if (!text) {
          reject(promptError('OPENCODE_EMPTY_RESPONSE'));
        } else {
          resolve({ text, stderr, events });
        }
      });
    });
  }

  return { runPrompt };
}

module.exports = { createPromptRunner };
