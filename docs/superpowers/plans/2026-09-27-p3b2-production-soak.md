# P3B2 Production Soak Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit Linux-only production soak phase after the existing MySQL capacity and recovery acceptance.

**Architecture:** A pure profile validates gates and bounded timing. A pure schedule rotates five-user cohorts across all twenty accounts. The existing production integration test consumes both after restart/history verification and performs real OpenCode canaries plus health sampling.

**Tech Stack:** Node test runner, MySQL 8.4, WebSocket, OpenCode Worker Pool.

**Spec:** `docs/dev-loop-runs/2026-09-27-p3b2-production-soak/00-requirements.md`

## Global Constraints

- Exact capacity, recovery and soak gates; Linux/TLS/dedicated acceptance database remain mandatory.
- Duration is an explicit integer from 60 to 1440 minutes; interval is an explicit integer from 60 to 3600 seconds.
- At least four cycles must be scheduled so every account participates.
- No cleanup of the remote database and no secret/private content in output.
- Existing capacity-only and recovery commands keep their behavior.

## Review Focus

- Missing or truthy-but-not-exact gates fail before any model request.
- Invalid timing cannot create zero coverage, a tight request loop or an unbounded run.
- Cohort rotation covers every user without duplicates within a cycle.
- Later prompts retrieve the first marker from context rather than receiving it again.
- Health degradation and every non-completed terminal outcome fail closed without retry masking.

---

### Task 1: Pure soak configuration and schedule

**Files:**
- Create: `src/gateway/production-soak-profile.js`
- Create: `test/fixtures/production-soak.js`
- Create: `test/gateway/production-soak-profile.test.js`

**Interfaces:**
- `loadProductionSoakProfile({ env, platform }) -> frozen { durationMinutes, intervalSeconds, durationMs, intervalMs, users, cohortSize, cycles }`
- `createProductionSoakSchedule({ users, cohortSize, durationMs, intervalMs }) -> frozen Array<{ offsetMs, userIndexes }>`

- [x] Write tests for exact gates, bounds, four-cycle minimum, redaction, frozen values and cohort coverage.
- [x] Run `node --test test/gateway/production-soak-profile.test.js` and verify RED because both modules are missing.
- [x] Implement strict integer parsing, reuse `loadProductionCapacityProfile`, and implement deterministic modulo rotation.
- [x] Re-run the focused test and verify GREEN.

### Task 2: Command contract and integration

**Files:**
- Modify: `package.json`
- Modify: `test/ops/deployment-contract.test.js`
- Modify: `test/integration/production-capacity.test.js`

**Interfaces:**
- New script: `test:production:soak` with all three exact gates.
- Integration consumes the profile/schedule and reports only safe counters.

- [x] Add contract assertions for the command, three gates, profile/schedule, both health endpoints and safe summary fields.
- [x] Run the deployment contract and verify RED because the command/integration is absent.
- [x] Add the optional soak phase after recovery restart/history verification.
- [x] Re-run focused tests, default integration skip and the explicit Mac command; expect GREEN/skip/`PRODUCTION_CAPACITY_LINUX_REQUIRED` respectively.

### Task 3: Handoff and release

**Files:**
- Modify: `README.md`
- Modify: `docs/PRODUCT_GOAL.md`
- Modify: `docs/ROADMAP.md`
- Modify: `docs/operations/company-preflight-handoff.md`
- Modify: `docs/operations/internal-provider.md`
- Create: `docs/dev-loop-runs/2026-09-27-p3b2-production-soak/03-implementation-log.md`
- Create: `docs/dev-loop-runs/2026-09-27-p3b2-production-soak/04-acceptance-report.md`
- Create: `docs/dev-loop-runs/2026-09-27-p3b2-production-soak/05-pr-summary.html`

- [x] Document the recommended 480-minute/900-second company run and the real-model cost boundary.
- [x] Run `npm test`, `npm run build`, `npm run check`, `npm run security:scan`, and `git diff --check`.
- [x] Record local evidence without claiming company soak success.
- [ ] Commit in Chinese, push `main`, fetch, and verify local/remote SHA equality.
