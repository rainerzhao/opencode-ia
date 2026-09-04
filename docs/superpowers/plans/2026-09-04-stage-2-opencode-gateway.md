# Stage 2 OpenCode Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-message OpenCode cold starts with a persistent, recoverable two-Worker Gateway that safely serves multiple authenticated users on Mac.

**Architecture:** Add a focused Gateway control plane beside the existing Express application. Persist conversations, jobs, worker metadata, OpenCode session mappings, and replayable events in SQLite; supervise two loopback-only `opencode serve` processes and communicate through the verified OpenCode 1.18.25 HTTP/SSE API. Schedule work with per-user round-robin fairness while enforcing global, user, and conversation limits.

**Tech Stack:** Node.js 24, built-in `node:sqlite`, Express 4, WebSocket `ws`, OpenCode 1.18.25 HTTP/SSE API, Node test runner, React 19, Vite.

**Spec:** `docs/architecture/stage-2-opencode-gateway.md`

## Global Constraints

- All model, Agent, Skill, and Tool execution remains inside OpenCode; the workbench never calls a model Provider directly.
- Workers bind only to `127.0.0.1` and use a random runtime Basic Auth password that is never persisted or logged.
- Browser input cannot select arbitrary host paths; Conversation workspaces are derived under the configured workbench data root.
- Private conversation content remains owner-only; administrators see operational metadata by default.
- Interrupted jobs with unknown side effects are never automatically replayed.
- Normal automated tests use a fake OpenCode server and never call a real model.
- Every 2A–2E stage updates README and roadmap, runs the full verification gate, commits in Chinese, pushes `origin main`, and verifies the remote SHA.

---

### Task 2A: Persistent Gateway domain and event contract

**Files:**
- Modify: `src/db/migrations.js`
- Create: `src/gateway/job-state.js`
- Create: `src/gateway/gateway-store.js`
- Create: `packages/shared/gateway-events.js`
- Create: `test/db/gateway-database.test.js`
- Create: `test/gateway/job-state.test.js`
- Create: `test/gateway/gateway-store.test.js`
- Modify: `README.md`
- Modify: `docs/ROADMAP.md`

**Interfaces:**
- `transitionJob(currentStatus, event): nextStatus`
- `createGatewayStore(db, { idFactory, clock }): { createConversation, listConversations, getOwnedConversation, createJob, transitionJob, appendEvent, listEventsAfter, upsertWorker, bindOpenCodeSession, recoverOnStartup }`
- `GATEWAY_EVENT_TYPES`: `job.accepted`, `job.queued`, `job.started`, `message.delta`, `job.completed`, `job.failed`, `job.cancelled`, `job.interrupted`, `worker.status`, `conversation.snapshot`

- [x] Write migration tests for strict tables, foreign keys, unique Conversation-to-OpenCode-Session mapping, per-Job idempotency keys, monotonic event sequences, and migration from an existing version-1 database.
- [x] Run `node --test --test-concurrency=1 test/db/gateway-database.test.js` and confirm failure because migration version 2 does not exist.
- [x] Add migration version 2 with `conversations`, `opencode_sessions`, `gateway_jobs`, `gateway_workers`, and `gateway_events`; add owner/status/time indexes without altering version-1 tables.
- [x] Re-run the database test and confirm pass.
- [x] Write state-machine tests proving allowed transitions (`queued → running → completed`, cancellation, timeout, interruption) and rejecting terminal-state mutation or `running → queued` rollback.
- [x] Run the state test and confirm failure because `job-state.js` does not exist.
- [x] Implement the immutable transition table and public error codes; then implement store ownership checks, transactional state/event writes, idempotent creation, bounded event reads, and startup recovery from `running` to `interrupted`.
- [x] Run Stage 2A tests plus `npm test`, `npm run build`, `npm run check`, `npm run security:scan`, and `git diff --check`.
- [x] Update README to split “多人基础对话” from “常驻 Gateway”, correct the completed Stage 1 status in the roadmap, record evidence, commit in Chinese, push `main`, and verify the remote SHA. Remote commit: `50ed662`.

### Task 2B: One supervised OpenCode Worker and direct API client

**Files:**
- Create: `src/gateway/worker-process.js`
- Create: `src/gateway/opencode-client.js`
- Create: `src/gateway/sse-parser.js`
- Create: `test/fixtures/fake-opencode-server.js`
- Create: `test/gateway/worker-process.test.js`
- Create: `test/gateway/opencode-client.test.js`
- Create: `test/gateway/sse-parser.test.js`
- Modify: `src/config.js`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- `createWorkerProcess({ command, cwd, env, hostname, port, password, spawnImpl, fetchImpl, clock }): { start, stop, health, status, endpoint }`
- `createOpenCodeClient({ endpoint, username, password, fetchImpl }): { health, createSession, prompt, subscribeEvents, abortSession, getSession }`
- `parseSseStream(readable, onEvent, signal): Promise<void>`

- [x] Write SSE parser tests for chunk boundaries, multi-line data, comments, malformed JSON isolation, abort, and output-size limits; run them and confirm the missing-module failure.
- [x] Implement a bounded UTF-8 SSE parser and re-run the tests to green.
- [x] Build a fake loopback OpenCode server implementing `/global/health`, `/event`, `/session`, `/session/:id/message`, and `/session/:id/abort` with controllable delays and failures.
- [x] Write client contract tests for Basic Auth, directory scoping, Session creation, prompt events, abort, non-2xx mapping, timeout, and version mismatch; verify RED.
- [x] Implement the direct HTTP/SSE client against the verified 1.18.25 request bodies and stable internal error codes; verify GREEN.
- [x] Write worker-process tests for loopback binding, random secret injection, readiness deadline, unexpected exit, graceful SIGTERM/SIGKILL fallback, and secret redaction; verify RED.
- [x] Implement `opencode serve --hostname 127.0.0.1 --port <port>` supervision with `OPENCODE_SERVER_PASSWORD` and health-based readiness; never use `shell: true`.
- [x] Run Stage 2B targeted tests and the full verification gate.
- [x] Update README/config docs with the real Worker boundary, record evidence, commit in Chinese, push `main`, and verify the remote SHA. Remote commit: `44826f6`.

### Task 2C: Worker pool, sticky sessions, and fair persistent queue

**Files:**
- Create: `src/gateway/fair-queue.js`
- Create: `src/gateway/worker-pool.js`
- Create: `src/gateway/gateway-service.js`
- Create: `test/gateway/fair-queue.test.js`
- Create: `test/gateway/worker-pool.test.js`
- Create: `test/gateway/gateway-service.test.js`
- Modify: `src/config.js`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- `createFairQueue({ maxQueuedPerUser }): { enqueue, remove, nextEligible, snapshot }`
- `createWorkerPool({ workerCount, workerFactory, heartbeatMs, heartbeatTimeoutMs }): { start, stop, acquire, release, markUnhealthy, snapshot }`
- `createGatewayService({ store, pool, queue, workspaceRoot, limits }): { start, stop, submit, cancel, subscribe, recover, snapshot }`

- [x] Write fair-queue tests with users A/B/C proving round-robin selection, per-user FIFO, queue-limit rejection, cancellation, and no starvation; verify RED before implementation.
- [x] Implement the deterministic queue with explicit user rings and re-run to GREEN.
- [x] Write Worker-pool tests for two parallel slots, sticky Session reuse, unhealthy Worker exclusion, heartbeat recovery, and clean shutdown; verify RED.
- [x] Implement the pool using injected Worker factories and persist only non-secret operational metadata.
- [x] Write Gateway-service tests proving same-Conversation serialization, different-Conversation parallelism, global limit 2, user running limit 1, idempotent submit, event sequencing, cancellation, timeout, and affected-only interruption on Worker exit; verify RED.
- [x] Implement scheduling and transactional job/event changes; derive workspace paths under `data/workspaces/<user-id>/<conversation-id>` using existing safe-path primitives.
- [x] Run a deterministic 20-user simulated load test and the full verification gate.
- [x] Update README with actual queue/Worker status, record evidence, commit in Chinese, push `main`, and verify the remote SHA. Remote commit: `5664786`.

### Task 2D: Conversation product API, reconnectable WebSocket, and UI

**Files:**
- Create: `src/modules/conversations/routes.js`
- Create: `src/modules/gateway/routes.js`
- Create: `test/api/conversations.test.js`
- Create: `test/websocket/gateway-protocol.test.js`
- Modify: `src/create-workbench-server.js`
- Modify: `apps/web/src/features/chat/ChatPage.jsx`
- Create: `apps/web/src/features/chat/ConversationList.jsx`
- Create: `apps/web/src/features/chat/ExecutionStatus.jsx`
- Modify: `apps/web/src/styles.css`
- Modify: `packages/shared/error-codes.js`
- Modify: `README.md`

**Interfaces:**
- REST: `GET/POST /api/conversations`, `GET/PATCH/DELETE /api/conversations/:id`, `POST /api/conversations/:id/jobs/:jobId/cancel`
- WebSocket client messages: `subscribe { conversationId, afterSequence }`, `prompt { conversationId, text, idempotencyKey }`, `cancel { conversationId, jobId }`
- WebSocket server messages: the Stage 2A event envelope `{ type, conversationId, jobId, sequence, occurredAt, data }`

- [ ] Write API tests proving create/list/rename/archive, owner isolation, CSRF enforcement, admin metadata-only access, invalid identifiers, and audit attribution; verify RED.
- [ ] Implement focused route modules backed by `gateway-store`, keeping private bodies out of admin responses.
- [ ] Write WebSocket tests for subscribe snapshot, prompt acceptance, queued/started/delta/completed order, reconnect from `afterSequence`, stale-sequence snapshot fallback, duplicate idempotency key, cancel ownership, and revoked login Session; verify RED.
- [ ] Replace the transient per-socket `sessions` execution path with Gateway subscriptions while retaining the existing authentication and Origin checks; keep the old message protocol only in Demo compatibility mode until UI cutover passes.
- [ ] Add UI contract tests for Conversation navigation, queue/run/interrupt status, stop action, reconnect notice, recovery boundary, and no private state in browser storage; verify RED.
- [ ] Implement the React multi-Conversation experience and accessible status feedback, then run build and targeted UI tests.
- [ ] Run authenticated desktop and narrow-screen browser acceptance with two users; check console errors, overflow, reconnect, cancellation, and private isolation.
- [ ] Run the full verification gate, update README screenshots/status, record evidence, commit in Chinese, push `main`, and verify the remote SHA.

### Task 2E: Restart recovery, operations view, and Stage 2 release gate

**Files:**
- Create: `src/gateway/recovery.js`
- Create: `src/modules/admin/gateway-routes.js`
- Create: `test/gateway/recovery.test.js`
- Create: `test/api/gateway-admin.test.js`
- Create: `test/integration/opencode-smoke.test.js`
- Create: `test/performance/gateway-concurrency.test.js`
- Modify: `apps/web/src/features/admin/AdminPage.jsx`
- Modify: `src/create-workbench-server.js`
- Modify: `scripts/start-demo.js`
- Modify: `README.md`
- Modify: `docs/ROADMAP.md`
- Update: `docs/dev-loop-runs/2026-09-04-stage-2-opencode-gateway/03-implementation-log.md`
- Update: `docs/dev-loop-runs/2026-09-04-stage-2-opencode-gateway/04-acceptance-report.md`
- Update: `docs/dev-loop-runs/2026-09-04-stage-2-opencode-gateway/05-pr-summary.html`

**Interfaces:**
- `recoverGateway({ store, pool, queue }): RecoveryReport`
- Admin REST: `GET /api/admin/gateway/health`, `GET /api/admin/gateway/workers`, `GET /api/admin/gateway/jobs`, `POST /api/admin/gateway/jobs/:id/cancel`
- Opt-in command: `OPENCODE_REAL_SMOKE=1 node --test --test-concurrency=1 test/integration/opencode-smoke.test.js`

- [ ] Write recovery tests from a copied SQLite fixture proving queued jobs re-enter in order, running jobs become `interrupted`, completed jobs remain terminal, unavailable Session mappings show a recovery boundary, and no task is automatically replayed; verify RED.
- [ ] Implement startup reconciliation after Worker readiness and before accepting new jobs; append audited recovery events.
- [ ] Write admin API tests for role enforcement, secret/private-body redaction, health degradation, Worker metadata, queue summary, and administrative cancellation; verify RED.
- [ ] Implement the operational routes and a compact admin health/queue panel.
- [ ] Add a deterministic 20-user test asserting no cross-user events, global concurrency never exceeds 2, user concurrency never exceeds 1, no starvation, and shutdown leaves recoverable database state.
- [ ] Run the real OpenCode smoke test only with `OPENCODE_REAL_SMOKE=1`; verify health, Session creation, one multi-turn Conversation, event receipt, abort, and process cleanup without printing credentials or prompts.
- [ ] Verify Demo remains no-key and isolated, then run `npm test`, `npm run build`, `npm run check`, `npm run security:scan`, and `git diff --check` from a clean process state.
- [ ] Perform Mac desktop/narrow-screen and forced Worker/Gateway restart acceptance; save screenshots and bounded test outputs.
- [ ] Complete implementation log, acceptance report, and self-contained HTML summary; update README and roadmap to mark only the verified Stage 2 scope complete.
- [ ] Commit in Chinese, push `main`, verify the remote SHA, and leave Linux/internal-Provider production validation explicitly pending.

## Self-review

- Spec coverage: persistent Sessions, two Workers, fairness, limits, cancellation, event replay, restart recovery, privacy, health, Mac validation, and Linux portability map to Tasks 2A–2E.
- Scope: Skill lifecycle, knowledge/solution publishing, Linux deployment, SSO, distributed scheduling, and automatic replay are explicit non-goals.
- Interface consistency: the Store owns durable truth, the Worker Process owns process lifecycle, the OpenCode Client owns HTTP/SSE, the Pool owns capacity, and the Gateway Service owns scheduling.
- Migration safety: version 2 only adds tables; every stage stays compatible with the existing version-1 account and audit foundation.
- Verification: each behavior is introduced through a failing test, followed by targeted and full regression checks; real model access is opt-in only.
