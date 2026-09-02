# Stage 1 Product Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the complete local-account product foundation while keeping every Git stage runnable, testable, and independently reversible.

**Architecture:** Expand the current Express application with focused SQLite, user, authentication, authorization, and audit modules before cutting the frontend over to React/Vite. Use server-side opaque sessions, Node.js `scrypt`, token hashes at rest, and dependency injection into the existing server. Keep OpenCode as the only AI execution engine and defer the persistent Gateway to Stage 2.

**Tech Stack:** Node.js 24, built-in `node:sqlite`, Express 4, WebSocket `ws`, Node test runner, React 19, Vite.

**Spec:** `docs/superpowers/specs/2026-09-01-team-ai-workbench-design.md`

## Global Constraints

- No self-registration and no default account or password.
- Provider credentials never enter the frontend, repository, workbench database, or logs.
- User identity comes from authenticated accounts, never from IP addresses.
- Private content remains owner-only until an explicit human publish action.
- Every AI operation continues through OpenCode.
- Every stage ends with full tests, syntax check, secret scan, browser/API acceptance as applicable, a Chinese commit, and `git push origin main`.

---

### Task 1A: SQLite and operator bootstrap foundation

**Files:**
- Create: `src/db/open-database.js`
- Create: `src/db/migrations.js`
- Create: `src/db/migrate.js`
- Create: `src/auth/password.js`
- Create: `src/users/user-store.js`
- Create: `src/sessions/session-store.js`
- Create: `src/audit/audit-store.js`
- Create: `src/bootstrap/bootstrap-admin.js`
- Create: `scripts/create-admin.js`
- Create: `test/db/database.test.js`
- Create: `test/auth/password.test.js`
- Create: `test/bootstrap/create-admin.test.js`
- Modify: `src/config.js`
- Modify: `.env.example`
- Modify: `package.json`

**Interfaces:**
- `openDatabase({ filename }): DatabaseSync`
- `migrateDatabase(db): { appliedVersions: number[] }`
- `hashPassword(password): Promise<string>` and `verifyPassword(password, encoded): Promise<boolean>`
- `createUserStore(db): { countUsers, createUser, findById, findByUsername, listUsers }`
- `createSessionStore(db): { createSession, findByTokenHash, revokeById, revokeForUser }`
- `createAuditStore(db): { append, list }`
- `bootstrapAdmin({ db, username, displayName, password, now }): Promise<PublicUser>`

- [x] Write database tests that assert migration version 1 creates `users`, `login_sessions`, and `audit_logs`, enables foreign keys and WAL on a file database, is idempotent, and persists one user across reopen.
- [x] Run `node --test --test-concurrency=1 test/db/database.test.js` and confirm failure because the database modules do not exist.
- [x] Implement `openDatabase`, immutable ordered migrations, and transactional `migrateDatabase`; add `DATABASE_PATH` defaulting to `<root>/data/workbench.db`.
- [x] Re-run the database test and confirm pass.
- [x] Write password tests for a valid password, wrong password, independent salts, malformed stored hashes, and minimum 12-character policy.
- [x] Run `node --test --test-concurrency=1 test/auth/password.test.js` and confirm failure because `password.js` does not exist.
- [x] Implement `scrypt$16384$8$1$<salt>$<hash>` encoding with 16 random salt bytes, 64 derived bytes, `timingSafeEqual`, and password length validation from 12 to 128 Unicode characters.
- [x] Re-run password tests and confirm pass.
- [x] Write bootstrap tests asserting only an empty database can create the first admin, usernames normalize to lowercase, no password appears in returned/public records, and an audit event is stored.
- [x] Run `node --test --test-concurrency=1 test/bootstrap/create-admin.test.js` and confirm failure because bootstrap modules do not exist.
- [x] Implement stores, `bootstrapAdmin`, and an interactive `npm run admin:create -- --username <name> --display-name <name>` command that reads password twice without accepting a password argument.
- [x] Run all Stage 1A tests plus `npm test`, `npm run check`, `npm run security:scan`, and `git diff --check`.
- [x] Update roadmap and implementation evidence, commit in Chinese, push `main`, and verify remote SHA.

### Task 1B: HTTP authentication and session security

**Files:**
- Create: `src/auth/session-tokens.js`
- Create: `src/auth/auth-service.js`
- Create: `src/auth/auth-middleware.js`
- Create: `src/auth/login-limiter.js`
- Create: `src/http/cookies.js`
- Create: `src/modules/auth/routes.js`
- Create: `src/modules/users/routes.js`
- Create: `test/api/auth.test.js`
- Create: `test/api/user-admin.test.js`
- Modify: `src/create-workbench-server.js`
- Modify: `src/config.js`

**Interfaces:**
- `createAuthService({ userStore, sessionStore, auditStore, clock }): { login, logout, authenticate, changePassword, resetPassword, disableUser }`
- `requireAuth(req, res, next)` and `requireRole('admin')`
- Routes: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/change-password`, admin user/session routes.

- [x] Write real HTTP tests for generic invalid-login errors, secure cookie attributes, CSRF enforcement, session expiry, logout, password change, admin create/reset/disable, and rate limiting.
- [x] Run the auth tests and confirm endpoint-not-found/authentication failures.
- [x] Implement opaque 32-byte tokens, SHA-256 token/CSRF hashes, cookie parsing/serialization, auth service, bounded in-memory login limiter, middleware, and routes.
- [x] Re-run auth tests and full verification.
- [ ] Record evidence, commit in Chinese, push `main`, and verify remote SHA. Local commit is ready; remote authentication must be refreshed before push verification.

### Task 1C: Authorization, privacy, WebSocket identity, and audit

**Files:**
- Create: `src/auth/permissions.js`
- Create: `src/audit/request-audit.js`
- Create: `test/api/authorization.test.js`
- Create: `test/websocket/authentication.test.js`
- Modify: `src/create-workbench-server.js`
- Modify: existing API and WebSocket tests to authenticate through shared test fixtures.

**Interfaces:**
- `can(user, action, resource): boolean`
- Authenticated WebSocket upgrade/connection associates `userId`, `role`, and `sessionId` with server session metadata.

- [ ] Add tests proving anonymous REST/WebSocket denial, admin/member role matrix, member-a/member-b private isolation, and audit attribution for write operations.
- [ ] Run targeted tests and confirm current anonymous access causes expected RED failures.
- [ ] Apply auth middleware to business routes, enforce role/ownership at the resource boundary, authenticate WebSocket cookies, and append safe audit metadata.
- [ ] Re-run all tests and security checks.
- [ ] Record evidence, commit in Chinese, push `main`, and verify remote SHA.

### Task 1D: Login and account-management user experience

**Files:**
- Create: `public/login.html`
- Create: `public/login.js`
- Create: `public/auth-client.js`
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/style.css`
- Create: `test/ui/auth-shell.test.js`

**Interfaces:**
- Browser calls `/api/auth/me` before opening business views or WebSocket.
- Login posts credentials, stores no token in JavaScript, and reads a server-issued CSRF value for state-changing requests.

- [ ] Add UI contract tests for accessible login fields, generic errors, logout, current-user role display, admin user management, and no token storage.
- [ ] Run UI tests and confirm missing login shell failures.
- [ ] Implement the login shell, authenticated fetch wrapper, role-aware navigation, account management, and logout.
- [ ] Run tests and perform desktop/mobile browser acceptance with admin and member accounts, including console errors and overflow checks.
- [ ] Save screenshots/evidence, commit in Chinese, push `main`, and verify remote SHA.

### Task 1E: React/Vite migration and Stage 1 release gate

**Files:**
- Create: `apps/web/` React/Vite application grouped by auth, shell, chat, knowledge, solutions, skills, and admin features.
- Create: `apps/server/` entrypoint that composes existing focused server modules without duplicating security logic.
- Create: `packages/shared/` API error codes and validation contracts.
- Modify: `package.json`, `package-lock.json`, `server.js`, `scripts/start-demo.js`, `README.md`, `docs/ROADMAP.md`.
- Create/modify: frontend tests and Stage 1 acceptance artifacts.

**Interfaces:**
- Vite build outputs static assets served by Express in production.
- Existing REST/WebSocket contracts remain compatible unless changed through a tested shared contract.

- [ ] Add build and route smoke tests before moving UI behavior.
- [ ] Install pinned React/Vite dependencies and create the application shell.
- [ ] Move one feature at a time while keeping existing API integration tests green; remove legacy `public/app.js` only after equivalent browser coverage passes.
- [ ] Update Demo to create isolated demo users and a temporary SQLite database without a real Provider key.
- [ ] Run full test, build, syntax, secret, responsive browser, shutdown cleanup, and public README verification.
- [ ] Complete the acceptance report and self-contained HTML PR summary.
- [ ] Commit in Chinese, push `main`, verify public remote SHA, and mark Stage 1 complete only if all exit criteria pass.

## Self-review

- Spec coverage: account bootstrap, SQLite, sessions, roles, audit, default privacy, React migration, Demo, documentation, and verification all map to Tasks 1A–1E.
- Placeholder scan: no deferred implementation placeholders are used; Stage 2 Gateway and Stage 3 asset lifecycle are explicit non-goals.
- Interface consistency: auth service, stores, middleware, routes, and frontend consumers use one server-side opaque-session model throughout.
- Migration safety: every task expands behavior first and leaves the previous stage runnable; legacy UI removal occurs only after React equivalence is proven.
