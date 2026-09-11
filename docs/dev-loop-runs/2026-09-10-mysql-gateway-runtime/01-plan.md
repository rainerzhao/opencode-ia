# MySQL Gateway Runtime Plan

## Goal

Migrate the runtime-facing business boundary to MySQL-safe asynchronous Store contracts without combining MySQL Gateway state with SQLite-backed business state in a production server.

## Architecture summary

Gateway runtime state is already durable in MySQL. HTTP and WebSocket boundaries must await either the legacy synchronous adapter or a durable asynchronous Store. Content routes are prepared before introducing the MySQL Content Store so a repository migration does not change ownership, publication or audit behavior at the API boundary.

## Task order

1. Complete and verify MySQL Gateway Store persistence.
2. Convert Gateway scheduling, execution and recovery to await it.
3. Convert administrative Gateway reads and cancellations to await it.
4. Prepare knowledge and solution routes for the asynchronous Content Store contract.
5. Implement MySQL Content Store, then MySQL Skill Store, and only then compose a MySQL-only server.

## Files and ownership

- Gateway persistence and execution: `src/gateway/`, `src/modules/gateway/`, `src/modules/admin/`.
- Content HTTP boundary: `src/modules/content/routes.js` and `test/api/content-routes-async.test.js`.
- Product status and acceptance: `README.md`, `docs/ROADMAP.md`, and this run directory.

## Verification

- Targeted async content route and existing content workflow tests.
- Full test suite, production build, JavaScript syntax check and secret scan.
- Real MySQL tests are retained for completed Gateway tasks and must run serially because startup recovery intentionally mutates running Jobs and active Sessions in the supplied test database.

## Risks and constraints

- Preserve private ownership, explicit publication/withdrawal and safe audit metadata.
- Never expose Store Promises in JSON responses or bypass domain error mapping.
- Do not describe Mac validation as Linux production readiness.
- The unrelated Stage 3C provenance documents remain untracked and outside this change.
