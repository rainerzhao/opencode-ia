# MySQL Content Store Plan

## Architecture

Create an asynchronous `createMySqlContentStore` that uses the existing MySQL v5 content tables. It will mirror the public contract of `createContentStore`, execute version changes in MySQL transactions and use ownership-filtered queries for every read. The current Express router will await either Store style without changing user-facing endpoints.

## Task order

1. Write and observe a failing real-MySQL behavioral test covering private isolation, versioning, publication, withdrawal, search and solution references.
2. Implement input normalization, ownership checks, row mapping and transactional knowledge/solution version operations.
3. Implement permission-filtered MySQL full-text search using the ngram index.
4. Run targeted MySQL acceptance, then full regression, build, syntax and secret checks.
5. Update product status and acceptance records; commit and push the verified unit.

## Files

- Add `src/content/mysql-content-store.js`
- Add `test/content/mysql-content-store.test.js`
- Modify product status and this run's implementation/acceptance artifacts

## Verification

- `WORKBENCH_TEST_MYSQL_URL=… node --test --test-concurrency=1 test/content/mysql-content-store.test.js`
- `npm test`
- `npm run build`
- `npm run check`
- `npm run security:scan`

## Risks

- Version pointer updates must not reveal a partial version or stale source reference.
- SQL must never leak private rows through search or list queries.
- MySQL full-text search syntax differs from SQLite FTS5; the test must prove the product-level visibility behavior rather than SQLite query syntax.
