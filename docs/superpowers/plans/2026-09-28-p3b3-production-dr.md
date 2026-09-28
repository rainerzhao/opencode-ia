# P3B3 Production Disaster Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the completed production acceptance dataset and attachment sidecar into a second empty TLS database and verify it through the production application.

**Architecture:** Extend the existing single lifecycle after soak. A pure profile validates the separate recovery database. The integration imports existing backup/restore implementations, checks the target is empty, restores, starts the target production workbench, then verifies login, conversation history and attachment bytes.

**Tech Stack:** Node test runner, MySQL 8.4 clients, mysql2, OpenCode production composition.

**Spec:** `docs/dev-loop-runs/2026-09-28-p3b3-production-dr/00-requirements.md`

## Global Constraints

- Exact capacity/recovery/soak/DR gates and Linux-only execution.
- Both databases use TLS and remain operator-managed; no cleanup or overwrite.
- Target name contains both acceptance and recovery/restore and must be distinct from source.
- URLs, hosts, database names, filesystem paths and private content never enter the summary.
- Existing commands remain unchanged.

## Review Focus

- A non-empty target fails before `mysql` restore starts.
- URL credentials stay in env and never appear in argv or thrown messages.
- Backup/restore use the stopped-source consistency window.
- Restored evidence is read through authenticated HTTP, not internal test objects.
- OpenCode Session recovery is not required for persisted history verification.

---

### Task 1: Pure DR profile

**Files:**
- Create: `src/gateway/production-dr-profile.js`
- Create: `test/gateway/production-dr-profile.test.js`

**Interfaces:**
- `loadProductionDrProfile({ env, platform }) -> frozen { source, target, targetCaFileConfigured }`

- [ ] Write tests for exact gate, target TLS/name, distinct source/target, separate CA and redacted output.
- [ ] Run the focused test and observe module-missing RED.
- [ ] Implement by composing `loadProductionSoakProfile` and `parseMySqlUrl`.
- [ ] Re-run focused tests and observe GREEN.

### Task 2: Command and integration

**Files:**
- Modify: `package.json`
- Modify: `test/ops/deployment-contract.test.js`
- Modify: `test/integration/production-capacity.test.js`

**Interfaces:**
- New script: `test:production:dr` with all four exact gates.
- Target URL: `WORKBENCH_RECOVERY_DATABASE_URL`; optional CA: `WORKBENCH_RECOVERY_MYSQL_SSL_CA_FILE`.

- [ ] Add command/source-contract assertions and observe RED.
- [ ] Add empty-target check, imported backup/restore calls, target production start and HTTP/canary verification.
- [ ] Re-run contract/profile tests, default skip and Mac fail-closed.

### Task 3: Handoff and release

**Files:**
- Modify README/product/roadmap/operations docs.
- Create implementation log, acceptance report and HTML summary in this run directory.

- [ ] Document application-level DR versus cloud snapshot/PITR boundaries.
- [ ] Run full tests, build, syntax, secret scan and diff check.
- [ ] Commit in Chinese, push `main`, fetch and verify SHA equality.
