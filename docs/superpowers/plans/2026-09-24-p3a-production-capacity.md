# P3A Production-path Capacity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fail-closed 20-user acceptance Harness that exercises the MySQL production composition and real OpenCode workers together.

**Architecture:** A pure profile loader validates the explicit Linux acceptance gate, dedicated database name, and fixed topology. An opt-in Node integration test starts the real MySQL production workbench, bootstraps an empty database, drives member HTTP/WebSocket flows, and emits only bounded operational evidence.

**Tech Stack:** Node.js test runner, Express, WebSocket, MySQL 8.4, OpenCode.

**Spec:** `docs/PRODUCT_GOAL.md`

## Global Constraints

- No automatic remote database reset or cleanup.
- No SQLite fixture in the production-path Harness.
- No Provider secrets, database URLs, prompts, replies, cookies or private titles in evidence.
- Normal CI skips the live test; explicit execution fails closed on missing gates.
- Harness readiness is not company-environment acceptance.

## Review Focus

- Non-Linux execution must be rejected by the profile loader.
- The database name must contain `acceptance`; URL values must never enter output.
- Topology must remain exactly 4 workers × 5 slots, global 20, per-user 1.
- Bootstrap must prove a fresh dedicated database instead of deleting prior data.
- A 401/403/429, timeout, cross-session marker or terminal task error must fail the run.

---

### Task 1: Production capacity profile

**Files:**
- Create: `src/gateway/production-capacity-profile.js`
- Create: `test/gateway/production-capacity-profile.test.js`

**Interfaces:**
- Produces: `loadProductionCapacityProfile({ env, platform })` returning a frozen redacted topology.

- [x] Write tests for disabled, non-Linux, non-acceptance database and valid fixed topology.
- [x] Run the focused test and verify RED because the module does not exist.
- [x] Implement the profile without logging the URL.
- [x] Run focused tests and verify GREEN.

### Task 2: Production composition live Harness

**Files:**
- Create: `test/integration/production-capacity.test.js`
- Modify: `test/ops/deployment-contract.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `loadProductionCapacityProfile`, `createMySqlProductionWorkbench`, HTTP auth routes and Gateway WebSocket protocol.
- Produces: `npm run test:capacity:20:production`.

- [x] Add deployment contract assertions for the new file and command.
- [x] Run the contract and verify RED.
- [x] Implement the opt-in Harness with fresh-database bootstrap and bounded evidence.
- [x] Run focused tests and verify GREEN; run the live command locally and verify it cannot claim success without Linux/company inputs.

### Task 3: Handoff and verification

**Files:**
- Modify: `README.md`
- Modify: `docs/PRODUCT_GOAL.md`
- Modify: `docs/ROADMAP.md`
- Modify: `docs/operations/company-preflight-handoff.md`
- Modify: `docs/operations/internal-provider.md`
- Create: `docs/dev-loop-runs/2026-09-24-p3a-production-capacity/03-implementation-log.md`
- Create: `docs/dev-loop-runs/2026-09-24-p3a-production-capacity/04-acceptance-report.md`
- Create: `docs/dev-loop-runs/2026-09-24-p3a-production-capacity/05-pr-summary.html`

**Interfaces:**
- Produces: truthful operator instructions and auditable stage evidence.

- [x] Update product and operator language without marking P3 complete.
- [x] Run full tests, build, syntax check, secret scan and diff check.
- [x] Record evidence and remaining company-environment gates.
- [ ] Commit in Chinese, push `main`, and verify `HEAD == origin/main`.
