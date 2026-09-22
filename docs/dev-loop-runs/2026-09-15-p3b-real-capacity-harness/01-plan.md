# P3B Real Capacity Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit 20-real-active-task acceptance entrypoint while preserving the existing simulated 20-user regression.

**Architecture:** Extend the capacity profile Module with a safe topology seam: `workerCount × workerCapacity = executionSlots`. The integration test consumes that profile rather than hard-coding one Worker. A new npm script explicitly opts into the real Runtime and passes a 4×5 topology; it cannot silently call the fake Worker.

**Tech Stack:** Node.js, Node test runner, authenticated HTTP/WebSocket fixture, existing Gateway Worker Pool.

**Spec:** `docs/dev-loop-runs/2026-09-15-p3b-real-capacity-harness/00-requirements.md`

### Task 1: Profile topology contract

**Files:** `test/gateway/capacity-acceptance-profile.test.js`, `src/gateway/capacity-acceptance-profile.js`

- [x] Write profile tests for the accepted `4×5=20` topology and rejected `5×5=25` topology.
- [x] Run `node --test test/gateway/capacity-acceptance-profile.test.js` and observe RED for the unbounded `5×5` topology.
- [x] Implement strict positive integer parsing, default 1×5 topology, and a 20-slot upper bound.
- [x] Re-run profile tests and confirm GREEN.

### Task 2: Gateway integration and explicit command

**Files:** `test/integration/five-users-multiround.test.js`, `package.json`

- [x] Make multi-session Worker Pool construction consume `profile.workerCount` and `profile.workerCapacity`.
- [x] Add `test:capacity:20:real` with `WORKBENCH_REAL_ACCEPTANCE=1`, 20 users, multi-session and 4×5 topology.
- [x] Run the existing simulated `npm run test:capacity:20`; confirm it remains 5-slot simulation.

### Task 3: Operator handoff and release

**Files:** `README.md`, `docs/ROADMAP.md`, `docs/operations/internal-provider.md`, run evidence documents.

- [x] State exact command, prerequisite gates and security boundary.
- [x] Run targeted tests, build, syntax, secret scan and diff check.
- [ ] Commit only stage files in Chinese and push main after remote SHA verification.
