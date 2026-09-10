# Acceptance Report

## Task 1: MySQL Gateway Store contract

**PASS — Mac Docker MySQL acceptance.** The real MySQL test covers private Conversation ownership, idempotent Jobs, ordered events, Worker and OpenCode Session persistence, running-Job binding, queue reconstruction, recovery session transitions, operational metadata, Conversation lifecycle, and restart interruption semantics.

Fresh verification completed before the phase commit:

- `npm test` — exit 0 (MySQL-dependent tests remain intentionally skipped when no test URL is configured).
- `WORKBENCH_TEST_MYSQL_URL=… node --test test/gateway/mysql-gateway-store.test.js` — 1 passed, 0 failed.
- `npm run build` — exit 0.
- `npm run check` — 139 JavaScript files passed syntax checking.
- `npm run security:scan` — no findings.

## Task 3.1: Asynchronous Gateway administration

**PASS — HTTP contract.** The administrator Job view now waits for durable asynchronous metadata rather than serializing a Promise, without exposing private prompt contents.

## Production boundary

This phase does not validate Linux deployment, real-provider capacity, long-run stability, OS process sandboxing, or a MySQL-only application composition.

## Task 2: Asynchronous Gateway runtime

**PASS — Mac Docker MySQL acceptance.** A delayed Worker metadata persistence test proves startup does not schedule a Job until the Worker exists in durable storage. The accepted Job creates and persists an OpenCode Session binding, uses that Session for the prompt, writes ordered events, and reaches `completed`.

Fresh verification completed before the phase commit:

- `npm test` — 289 passed, 0 failed, 11 intentionally skipped.
- `WORKBENCH_TEST_MYSQL_URL=… node --test --test-concurrency=1 test/gateway/mysql-gateway-store.test.js test/gateway/mysql-gateway-service.test.js` — 2 passed, 0 failed.
- `npm run build` — exit 0.
- `npm run check` — 140 JavaScript files passed syntax checking.
- `npm run security:scan` — no findings.
