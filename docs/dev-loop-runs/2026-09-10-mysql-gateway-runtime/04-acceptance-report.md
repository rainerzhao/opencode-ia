# Acceptance Report

## Task 1: MySQL Gateway Store contract

**PASS — Mac Docker MySQL acceptance.** The real MySQL test covers private Conversation ownership, idempotent Jobs, ordered events, Worker and OpenCode Session persistence, running-Job binding, queue reconstruction, recovery session transitions, operational metadata, Conversation lifecycle, and restart interruption semantics.

Fresh verification completed before the phase commit:

- `npm test` — exit 0 (MySQL-dependent tests remain intentionally skipped when no test URL is configured).
- `WORKBENCH_TEST_MYSQL_URL=… node --test test/gateway/mysql-gateway-store.test.js` — 1 passed, 0 failed.
- `npm run build` — exit 0.
- `npm run check` — 139 JavaScript files passed syntax checking.
- `npm run security:scan` — no findings.

## Production boundary

This phase does not validate Linux deployment, real-provider capacity, long-run stability, OS process sandboxing, or a MySQL-only application composition.
