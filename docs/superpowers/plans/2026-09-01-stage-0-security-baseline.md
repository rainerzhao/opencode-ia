# Stage 0 Security Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing workbench portable, testable, and safe against the already identified secret, process, filesystem, URL-fetch, upload, and WebSocket concurrency risks without changing its product architecture yet.

**Architecture:** Extract small security and runtime boundaries around the existing Express/WebSocket application. Keep the current frontend and REST surface, but move configuration, filesystem policy, OpenCode process execution, and server lifecycle behind independently testable modules. Use real child processes, ephemeral HTTP servers, temporary directories, and Node's built-in test runner.

**Tech Stack:** Node.js 24 development runtime, CommonJS, Express 4, ws 8, multer 2, `node:test`, built-in `fetch`, built-in `crypto` and filesystem APIs.

**Spec:** `docs/superpowers/specs/2026-09-01-team-ai-workbench-design.md`

## Global Constraints

- All model inference, Agent, Skill, and tool execution continues through OpenCode.
- Do not call a model API directly.
- Do not alter or delete existing knowledge documents.
- Do not add a public default password or include a real secret in any fixture.
- Do not use Shell command strings for OpenCode execution.
- URL fetching is deny-by-default and host-allowlist-based.
- Ordinary tests must not call a real paid model.
- No commit, push, or external publication without separate user authorization.
- TDD is mandatory for production behavior changes: add one failing behavior test, run it and record the expected failure, implement the smallest fix, then rerun it green.

---

### Task 1: Portable runtime configuration and path policy

**Files:**
- Create: `src/config.js`
- Create: `src/security/path-policy.js`
- Create: `test/config.test.js`
- Create: `test/security/path-policy.test.js`
- Modify: `server.js`

**Interfaces:**
- Produces: `loadConfig({ env, projectDir }) -> Config`
- Produces: `resolveWithinRoot(root, relativePath, options) -> absolutePath`
- Produces: `validateFileName(name) -> normalizedName`
- Consumes: Node `path`, `fs`, and environment variables only.

- [ ] **Step 1: Write failing configuration tests**

Create `test/config.test.js` with literal expectations proving that project paths are derived from an injected project directory and environment overrides are validated:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadConfig } = require('../src/config');

test('derives data paths from the injected project directory', () => {
  const config = loadConfig({ env: {}, projectDir: '/srv/workbench' });
  assert.equal(config.knowledgeDir, path.resolve('/srv/workbench/knowledge'));
  assert.equal(config.solutionsDir, path.resolve('/srv/workbench/solutions'));
  assert.equal(config.port, 3000);
});

test('rejects invalid positive integer limits', () => {
  assert.throws(
    () => loadConfig({ env: { MAX_SESSIONS: '0' }, projectDir: '/srv/workbench' }),
    /MAX_SESSIONS/
  );
});
```

- [ ] **Step 2: Run configuration tests and verify RED**

Run: `node --test test/config.test.js`

Expected: FAIL because `src/config.js` does not exist.

- [ ] **Step 3: Implement the minimal configuration loader**

Create `src/config.js` with a strict `positiveInteger` parser and these environment variables:

```js
function loadConfig({ env = process.env, projectDir }) {
  const root = path.resolve(env.WORKBENCH_ROOT || projectDir);
  return Object.freeze({
    projectDir: root,
    port: positiveInteger(env.PORT, 3000, 'PORT'),
    maxSessions: positiveInteger(env.MAX_SESSIONS, 20, 'MAX_SESSIONS'),
    opencodeTimeoutMs: positiveInteger(env.OPENCODE_TIMEOUT_MS, 120000, 'OPENCODE_TIMEOUT_MS'),
    opencodeMaxOutputBytes: positiveInteger(env.OPENCODE_MAX_OUTPUT_BYTES, 10 * 1024 * 1024, 'OPENCODE_MAX_OUTPUT_BYTES'),
    opencodeCmd: env.OPENCODE_CMD || path.join(env.HOME || '', '.opencode/bin/opencode'),
    opencodeCwd: path.resolve(env.OPENCODE_CWD || root),
    knowledgeDir: path.resolve(env.KNOWLEDGE_DIR || path.join(root, 'knowledge')),
    solutionsDir: path.resolve(env.SOLUTIONS_DIR || path.join(root, 'solutions')),
    skillsDir: path.resolve(env.SKILLS_DIR || path.join(root, '.opencode/skills')),
    uploadTempDir: path.resolve(env.UPLOAD_TEMP_DIR || path.join(root, 'data/tmp/uploads')),
    fetchAllowedHosts: parseHostList(env.KNOWLEDGE_FETCH_ALLOWED_HOSTS || '')
  });
}
```

- [ ] **Step 4: Run configuration tests and verify GREEN**

Run: `node --test test/config.test.js`

Expected: 2 tests pass.

- [ ] **Step 5: Write failing path-policy tests**

Create `test/security/path-policy.test.js` using a temporary root. Cover these literal cases:

```js
test('accepts a normal Chinese markdown path inside the root', () => {
  assert.equal(
    resolveWithinRoot('/srv/knowledge', 'gpu/选型指南.md', { extensions: ['.md'] }),
    path.resolve('/srv/knowledge/gpu/选型指南.md')
  );
});

for (const candidate of ['../secret', '/etc/passwd', 'gpu/../../secret', 'gpu/evil\0.md']) {
  test(`rejects unsafe path: ${JSON.stringify(candidate)}`, () => {
    assert.throws(() => resolveWithinRoot('/srv/knowledge', candidate), /unsafe path/i);
  });
}

test('rejects a sibling directory with the same string prefix', () => {
  assert.throws(
    () => resolveWithinRoot('/srv/knowledge', '../knowledge-private/file.md'),
    /unsafe path/i
  );
});
```

Also test `validateFileName` rejects `/`, `\\`, `.` and `..`, and returns `选型指南.md` unchanged.

Create a temporary root containing a symlink whose target is outside the root. Assert that resolving `link/secret.md` fails even though its lexical path begins with the knowledge root.

- [ ] **Step 6: Run path-policy tests and verify RED**

Run: `node --test test/security/path-policy.test.js`

Expected: FAIL because `src/security/path-policy.js` does not exist.

- [ ] **Step 7: Implement the minimal path policy**

Implement `resolveWithinRoot` with `path.resolve`, `path.relative`, absolute-path rejection, NUL rejection, optional extension allowlist, and the invariant `relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)`.

Lexical containment is not sufficient. Resolve the real path of the root and the candidate when it exists. For a new write target, walk upward to the nearest existing ancestor, resolve that ancestor with `fs.realpathSync`, and verify it is still below the real root before returning the candidate. This makes existing intermediate symlinks unable to escape the root.

Implement `validateFileName` using Unicode normalization (`NFC`), basename equality, `.`/`..` rejection, separator rejection, NUL rejection, and a 255-byte UTF-8 limit.

- [ ] **Step 8: Run Task 1 tests and verify GREEN**

Run: `node --test test/config.test.js test/security/path-policy.test.js`

Expected: all tests pass.

- [ ] **Step 9: Wire configuration into the current entrypoint**

Replace absolute `PROJECT_DIR` and inline `CONFIG` construction in `server.js` with:

```js
const { loadConfig } = require('./src/config');
const CONFIG = loadConfig({ env: process.env, projectDir: __dirname });
```

Do not apply the path helper to routes yet; Task 4 owns route behavior.

- [ ] **Step 10: Run syntax and Task 1 regression checks**

Run: `node --check server.js && node --check src/config.js && node --check src/security/path-policy.js && node --test test/config.test.js test/security/path-policy.test.js`

Expected: exit 0.

---

### Task 2: Parameterized, bounded, cancellable OpenCode runner

**Files:**
- Create: `src/opencode/run-prompt.js`
- Create: `test/fixtures/fake-opencode.js`
- Create: `test/opencode/run-prompt.test.js`
- Modify: `server.js`

**Interfaces:**
- Produces: `createPromptRunner(options) -> runPrompt(input, runOptions)`
- `runPrompt` resolves to `{ text, stderr, events }`.
- `runOptions` accepts `{ signal, onEvent }`.
- Consumes: `CONFIG.opencodeCmd`, `CONFIG.opencodeCwd`, timeout and output limits from Task 1.

- [ ] **Step 1: Create a real process fixture**

Create `test/fixtures/fake-opencode.js` with a Node shebang and executable permission so it can also act as `OPENCODE_CMD` during browser acceptance. It must inspect `process.argv`, emit line-delimited JSON using the same `type: "text", part.text` contract, recognize reserved test prompts for delay/oversize/nonzero/empty behavior, and handle `SIGTERM` by optionally writing a marker path supplied only in test arguments.

- [ ] **Step 2: Write the failing argument-boundary test**

Create `test/opencode/run-prompt.test.js` and invoke the real Node executable with `baseArgs` pointing to the fixture:

```js
test('passes shell metacharacters as one message argument', async () => {
  const marker = path.join(tempDir, 'must-not-exist');
  const runner = createPromptRunner({
    command: process.execPath,
    baseArgs: [fixturePath],
    cwd: tempDir,
    timeoutMs: 2000,
    maxOutputBytes: 1024 * 1024
  });
  const prompt = `hello"; touch ${marker}; echo "world`;
  const result = await runner.runPrompt(prompt);
  assert.equal(result.text, prompt);
  assert.equal(fs.existsSync(marker), false);
});
```

The fixture's normal text event must echo exactly the message argument after `run --format json`.

- [ ] **Step 3: Run the argument test and verify RED**

Run: `node --test --test-name-pattern='passes shell metacharacters' test/opencode/run-prompt.test.js`

Expected: FAIL because `createPromptRunner` does not exist.

- [ ] **Step 4: Implement minimal parameterized execution**

Use `child_process.spawn(command, [...baseArgs, 'run', '--format', 'json', input], { cwd, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })`.

Parse stdout incrementally by newline. Accumulate `event.part.text` only for `type === 'text'`. Call `onEvent(event)` for parsed events. Preserve bounded stderr for diagnostics.

- [ ] **Step 5: Run the argument test and verify GREEN**

Run the command from Step 3.

Expected: 1 test passes and no marker file is created.

- [ ] **Step 6: Add failing timeout, abort, output-limit, exit, and empty-response tests**

Add separate tests asserting these stable error codes:

- delayed fixture exceeds timeout → `OPENCODE_TIMEOUT`
- `AbortController.abort()` terminates child → `OPENCODE_ABORTED`
- fixture exceeds output byte limit → `OPENCODE_OUTPUT_LIMIT`
- fixture exits non-zero → `OPENCODE_EXIT_ERROR`
- fixture exits zero without a text event → `OPENCODE_EMPTY_RESPONSE`

Each test must exercise a real spawned fixture process, not assert on a spawn mock.

- [ ] **Step 7: Run the new tests and verify RED**

Run: `node --test test/opencode/run-prompt.test.js`

Expected: the new boundary tests fail because the minimal runner does not yet enforce them.

- [ ] **Step 8: Implement the remaining process boundaries**

Add one settlement path that clears the timeout, removes abort listeners, terminates the child once, and rejects with an error carrying `code` and a sanitized message. Count stdout and stderr bytes together. Send `SIGTERM`, then `SIGKILL` after a short configurable grace period if the child remains alive.

- [ ] **Step 9: Run runner tests and verify GREEN**

Run: `node --test test/opencode/run-prompt.test.js`

Expected: all runner tests pass with no leaked child process warnings.

- [ ] **Step 10: Replace `exec` in `server.js`**

Remove `child_process.exec` and the interpolated `cmd` string. Create one runner from configuration and call `runner.runPrompt(input, { signal, onEvent })`. Map runner errors to the existing WebSocket `error` message without returning command lines, environment variables, or raw secrets.

- [ ] **Step 11: Verify Task 2**

Run: `node --check server.js && node --test test/opencode/run-prompt.test.js`

Expected: exit 0.

---

### Task 3: Testable server lifecycle and WebSocket concurrency controls

**Files:**
- Create: `src/create-workbench-server.js`
- Create: `test/websocket/session-controls.test.js`
- Modify: `server.js`

**Interfaces:**
- Produces: `createWorkbenchServer({ config, promptRunner, logger }) -> { app, httpServer, start, stop, sessions }`
- `start(port = config.port)` resolves to the actual bound address.
- `stop()` closes WebSockets, aborts active runs, and closes HTTP.
- Consumes: Task 2 runner and Task 1 configuration.

- [ ] **Step 1: Write a failing ephemeral-server lifecycle test**

Start the server on port `0`, request `/api/config`, assert status 200 and `activeSessions: 0`, then stop it. Use the real HTTP server and built-in `fetch`.

- [ ] **Step 2: Run lifecycle test and verify RED**

Run: `node --test test/websocket/session-controls.test.js`

Expected: FAIL because importing the current `server.js` immediately listens and no factory exists.

- [ ] **Step 3: Extract the server factory without changing routes**

Move Express, HTTP, WebSocket, multer, route registration and session setup into `createWorkbenchServer`. Keep `server.js` as a thin entrypoint:

```js
const { loadConfig } = require('./src/config');
const { createPromptRunner } = require('./src/opencode/run-prompt');
const { createWorkbenchServer } = require('./src/create-workbench-server');

const config = loadConfig({ env: process.env, projectDir: __dirname });
const promptRunner = createPromptRunner({
  command: config.opencodeCmd,
  baseArgs: [],
  cwd: config.opencodeCwd,
  env: process.env,
  timeoutMs: config.opencodeTimeoutMs,
  maxOutputBytes: config.opencodeMaxOutputBytes
});
const workbench = createWorkbenchServer({ config, promptRunner, logger: console });
workbench.start().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

Do not change frontend behavior or route names in this step.

- [ ] **Step 4: Run lifecycle test and verify GREEN**

Run: `node --test test/websocket/session-controls.test.js`

Expected: lifecycle test passes and the test process exits cleanly.

- [ ] **Step 5: Add failing WebSocket behavior tests**

Using real `ws` clients against the ephemeral server, add tests for:

1. With `maxSessions: 1`, the first connection receives `connected`; the second closes with code `1013` and reason `MAX_SESSIONS_REACHED`.
2. Sending a second `input` before the first completes returns `{ type: 'error', code: 'SESSION_BUSY' }` and starts no second child.
3. Closing a socket during a delayed fixture run causes the fixture's SIGTERM marker to appear.
4. Session removal updates `/api/config` from `activeSessions: 1` to `0`.

- [ ] **Step 6: Run WebSocket tests and verify RED**

Run: `node --test test/websocket/session-controls.test.js`

Expected: new tests fail because the existing code only counts sessions and never rejects, serializes, or aborts runs.

- [ ] **Step 7: Implement session controls**

Before accepting a WebSocket session, enforce `sessions.size >= config.maxSessions`. Store `{ user, startTime, activeAbortController }`. Reject new input while an active controller exists. Clear the controller in `finally`. On socket close and server stop, call `abort()` before deleting the session.

WebSocket errors must include a stable `code` and safe `message`.

- [ ] **Step 8: Run Task 3 tests and verify GREEN**

Run: `node --test test/websocket/session-controls.test.js`

Expected: all lifecycle and session tests pass and process exits without open handles.

---

### Task 4: Secure knowledge routes, uploads, and URL fetching

**Files:**
- Create: `src/security/url-policy.js`
- Create: `test/security/url-policy.test.js`
- Create: `test/api/knowledge-security.test.js`
- Modify: `src/create-workbench-server.js`

**Interfaces:**
- Produces: `assertAllowedFetchUrl(rawUrl, allowedHosts) -> URL`
- Produces: `fetchAllowedText(rawUrl, { allowedHosts, fetchImpl, maxRedirects }) -> { finalUrl, text }`
- Consumes: `resolveWithinRoot` and `validateFileName` from Task 1.
- Preserves existing REST route paths.

- [ ] **Step 1: Write failing URL policy tests**

Cover these literal outcomes:

```js
assert.throws(() => assertAllowedFetchUrl('http://127.0.0.1/admin', []), /not allowed/i);
assert.throws(() => assertAllowedFetchUrl('file:///etc/passwd', ['docs.example.com']), /protocol/i);
assert.throws(() => assertAllowedFetchUrl('https://evil.example/', ['docs.example.com']), /not allowed/i);
assert.equal(
  assertAllowedFetchUrl('https://docs.example.com/guide', ['docs.example.com']).hostname,
  'docs.example.com'
);
```

Also reject credential-bearing URLs and explicit non-default ports unless the exact `host:port` entry is allowlisted.

Start a local test HTTP server on an ephemeral port. Allowlist its exact `127.0.0.1:<port>` host, make it redirect to an unallowlisted `localhost:<port>` URL, and assert `fetchAllowedText` rejects the redirect without issuing the second request.

- [ ] **Step 2: Run URL tests and verify RED**

Run: `node --test test/security/url-policy.test.js`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement deny-by-default URL policy**

Allow only `http:` and `https:`. Reject usernames/passwords. Normalize hostname with `domainToASCII`. Match an exact normalized hostname or exact host-and-port entry; do not implement wildcard suffix matching in Stage 0.

Implement `fetchAllowedText` with `redirect: 'manual'`. Validate the initial URL and every `Location` target before following it. Resolve relative redirects against the current URL, enforce a maximum of five redirects, and reject a missing or malformed redirect target. Do not use the platform's automatic redirect mode.

- [ ] **Step 4: Run URL tests and verify GREEN**

Run the command from Step 2.

Expected: all URL tests pass.

- [ ] **Step 5: Write failing knowledge API traversal tests**

Start a real ephemeral server with a temporary knowledge root containing `gpu/guide.md` and a sibling secret file. Assert:

- `GET /api/knowledge/article?path=gpu%2Fguide.md` returns 200.
- read with `../secret.md` returns 400 and never returns secret contents.
- save with `../escape.md` returns 400 and creates no sibling file.
- new article with title `../../escape` returns 400.
- delete with an absolute path returns 400 and preserves the target.
- fetch URL with no allowed hosts returns 403 without calling the network.

- [ ] **Step 6: Run knowledge API tests and verify RED**

Run: `node --test test/api/knowledge-security.test.js`

Expected: traversal assertions fail against current route behavior.

- [ ] **Step 7: Apply the path and URL policies to every route**

Use `resolveWithinRoot` for article read, write, new, delete, fetch destination, upload category, solutions files, and Skill scan paths derived from external input. Enforce `.md` where article endpoints require Markdown.

Add centralized error middleware that maps policy errors to status 400 or 403 and returns `{ error: { code, message, requestId } }` without absolute filesystem paths.

- [ ] **Step 8: Run knowledge API tests and verify GREEN**

Run the command from Step 6.

Expected: all traversal and default-deny URL tests pass.

- [ ] **Step 9: Add failing upload boundary tests**

Using built-in `FormData` and `Blob`, cover:

- accepted `guide.md` in category `gpu` lands only in `<knowledge>/gpu/guide.md`.
- category `../../outside` returns 400 and creates no outside file.
- filename `../escape.md` or a separator-bearing normalized name returns 400.
- disallowed extension returns 400.
- failed multi-file upload cleans temporary files.

- [ ] **Step 10: Run upload tests and verify RED**

Run: `node --test test/api/knowledge-security.test.js`

Expected: the new upload tests expose current dynamic-destination and cleanup defects.

- [ ] **Step 11: Implement fixed temporary upload storage and safe promotion**

Configure multer to write only into `config.uploadTempDir`, never a request-derived directory. After multer finishes, validate category and every normalized filename, then move accepted files into the resolved knowledge destination. On any error, delete only the explicit temporary files created by this request. Keep the current extension allowlist and 50 MB per-file limit for Stage 0.

- [ ] **Step 12: Run Task 4 tests and verify GREEN**

Run: `node --test test/security/url-policy.test.js test/api/knowledge-security.test.js`

Expected: all tests pass and temporary directories are empty after each test.

---

### Task 5: Secret hygiene, dependency cleanup, and operator documentation

**Files:**
- Create: `.gitignore`
- Create: `.env.example`
- Create: `scripts/scan-secrets.js`
- Create: `test/security/secret-scan.test.js`
- Modify: `PROJECT_HANDOFF.md`
- Modify: `README.md`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `npm run security:scan`
- Produces: documented configuration variables matching `src/config.js`.
- No production runtime interface changes.

- [ ] **Step 1: Write the failing project secret-scan test**

Create a test that recursively scans project-owned text files while excluding `.git`, `node_modules`, runtime `data`, backups, generated logs, and test fixtures explicitly marked with non-secret sentinel strings. It must detect at least:

- `sk-` followed by 16 or more token characters.
- `apiKey` or `api_key` assigned a non-placeholder literal.
- PEM private key headers.

Run it against the current project and assert no findings.

- [ ] **Step 2: Run secret scan and verify RED**

Run: `node --test test/security/secret-scan.test.js`

Expected: FAIL and report `PROJECT_HANDOFF.md` without printing the secret value.

- [ ] **Step 3: Redact project secrets and document rotation**

Replace the handoff's literal key with an environment-variable example and a prominent note that the exposed credential must be rotated at the Provider. Do not modify the user's live OpenCode provider configuration in this task.

Create `.env.example` with safe placeholders for every Task 1 variable. Create `.gitignore` covering `.env`, `data/`, `server.log`, `*.db*`, `.DS_Store`, coverage, build output, and temporary upload files.

- [ ] **Step 4: Implement the reusable secret scan command**

Move scan logic into `scripts/scan-secrets.js`; make it return a non-zero exit code with relative file paths and rule names only. The test invokes the real script in a temporary fixture project and verifies both clean and intentionally unsafe cases.

- [ ] **Step 5: Run secret tests and verify GREEN**

Run: `node --test test/security/secret-scan.test.js && node scripts/scan-secrets.js`

Expected: exit 0 and no project findings.

- [ ] **Step 6: Remove the unused node-pty dependency**

Run: `npm uninstall node-pty`

Expected: `package.json` and lockfile no longer list `node-pty`; application source has no `require('node-pty')` use.

- [ ] **Step 7: Add standard scripts**

Set these scripts in `package.json`:

```json
{
  "test": "node --test --test-concurrency=1",
  "check": "node scripts/check-js.js",
  "security:scan": "node scripts/scan-secrets.js"
}
```

Create `scripts/check-js.js` to enumerate project-owned `.js` files outside ignored runtime/vendor directories and run `node --check` for each using `spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' })`.

- [ ] **Step 8: Update README for Stage 0 operation**

Document:

- supported development Node version and install command.
- `.env.example` workflow without real secrets.
- `npm test`, `npm run check`, and `npm run security:scan`.
- OpenCode command, timeout, output, URL allowlist, path, and session variables.
- the fact that URL import is disabled until hosts are explicitly allowed.
- Mac start procedure and the planned Linux migration boundary.
- known Stage 0 limitation: chat still uses one bounded `opencode run` per message until Stage 2 introduces the persistent Gateway.

- [ ] **Step 9: Verify Task 5**

Run: `npm test && npm run check && npm run security:scan`

Expected: exit 0 with no test failures, syntax errors, or secret findings.

---

### Task 6: Full Stage 0 acceptance and browser smoke test

**Files:**
- Create: `docs/dev-loop-runs/2026-09-01-stage-0-security-baseline/artifacts/test-outputs/full-verification.txt`
- Create: `docs/dev-loop-runs/2026-09-01-stage-0-security-baseline/artifacts/screenshots/home.png`
- Create: `docs/dev-loop-runs/2026-09-01-stage-0-security-baseline/artifacts/screenshots/knowledge.png`
- Modify: `docs/dev-loop-runs/2026-09-01-stage-0-security-baseline/03-implementation-log.md`
- Modify: `docs/dev-loop-runs/2026-09-01-stage-0-security-baseline/04-acceptance-report.md`

**Interfaces:**
- Consumes: all Stage 0 tasks.
- Produces: evidence for every acceptance criterion in `00-requirements.md`.

- [ ] **Step 1: Run the complete non-model verification suite**

Run from the project root:

```bash
npm test
npm run check
npm run security:scan
```

Capture command, timestamp, exit code, test count, failure count, and complete output in `artifacts/test-outputs/full-verification.txt`.

- [ ] **Step 2: Run an explicit mutation check for the command boundary**

Temporarily apply a test-only patch that changes the runner to `{ shell: true }`, run the shell-metacharacter regression test and confirm it fails, then restore the safe implementation with `apply_patch` and rerun the test green. Do not use destructive Git restore commands.

- [ ] **Step 3: Start the application with the fake OpenCode fixture**

Use `OPENCODE_CMD` to point directly at the executable fake OpenCode fixture, bind a dedicated local port, and start the service in a managed terminal session. Confirm `/api/config` and `/api/knowledge/tree` return 200 before browser work.

- [ ] **Step 4: Perform browser smoke verification**

Use the browser automation skill to verify:

- home page loads at desktop width.
- navigation to AI and knowledge pages works.
- model badge renders a safe configured display value.
- a normal fake chat receives a response.
- an intentionally delayed chat exposes a safe timeout error.
- knowledge tree shows the three existing example documents.
- browser console contains no uncaught errors.
- no body-level horizontal overflow at 1440×900 and 390×844.

Save desktop home and knowledge screenshots to the specified artifact paths.

- [ ] **Step 5: Review security and concurrency evidence**

Map each `00-requirements.md` acceptance criterion to one named test or browser observation. Any criterion without evidence is a failed acceptance item, even if the suite is green.

- [ ] **Step 6: Write the implementation and acceptance reports**

`03-implementation-log.md` records each task's RED command/output, GREEN command/output, changed files, and concerns.

`04-acceptance-report.md` uses the required verdict `PASS`, `PASS_WITH_NOTES`, or `FAIL` and includes scope, reviewers, tests, requirement coverage, findings, fixes, residual risks, and follow-ups.

- [ ] **Step 7: Stop all local acceptance processes**

Stop only the explicit test application and fixture processes started in Step 3. Verify the dedicated port no longer accepts connections. Do not terminate unrelated OpenCode or Node processes.
