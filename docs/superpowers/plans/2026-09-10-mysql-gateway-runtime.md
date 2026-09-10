# MySQL Gateway Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Gateway runtime executable against MySQL without a SQLite/MySQL mixed production composition.

**Architecture:** First complete the asynchronous MySQL Store contract and prove it against MySQL 8.4. Then convert Gateway scheduling, execution, recovery, WebSocket and administrator routes to await that contract while retaining the synchronous SQLite test adapter until the final application composition switch.

**Tech Stack:** Node.js, Express, mysql2/promise, MySQL 8.4, Node test runner.

**Spec:** `docs/dev-loop-runs/2026-09-10-mysql-gateway-runtime/00-requirements.md`

## Global Constraints

- MySQL is the target single business fact source; OpenCode is the only Agent Runtime.
- Never make a MySQL Gateway plus SQLite business Store a production server combination.
- Preserve account ownership, per-Conversation serialization, fair queueing, replayable events, and recovery boundaries.
- Run test-first and push a Chinese commit after each independently verifiable phase.

---

### Task 1: Complete the MySQL Gateway Store contract

**Files:**
- Modify: `src/gateway/mysql-gateway-store.js`
- Modify: `test/gateway/mysql-gateway-store.test.js`
- Modify: `README.md`

**Interfaces:**
- Consumes: MySQL migrations v1–v5 and SQLite Store behavior.
- Produces: asynchronous Conversation, Job, event, worker and session methods used by Gateway Service and admin routes.

- [x] **Step 1: Write the failing real-MySQL test** for binding, queue, recovery, metadata and Conversation lifecycle.
- [x] **Step 2: Run it and confirm it fails** because `attachJobBinding` is absent.
- [x] **Step 3: Implement matching asynchronous methods** with ownership and status validation.
- [x] **Step 4: Run the real-MySQL test and confirm it passes.**
- [x] **Step 5: Update product status and run full verification; commit and push follows this accepted evidence.**

### Task 2: Make Gateway scheduling and execution asynchronous

**Files:**
- Modify: `src/gateway/gateway-service.js`
- Modify: `src/gateway/fair-queue.js`
- Modify: `test/gateway/gateway-service-async-store.test.js`

**Interfaces:**
- Consumes: Task 1 Store contract.
- Produces: a Service whose dispatch, execution, cancellation, subscription and runtime recovery await either Store type safely.

- [ ] **Step 1: Add one failing behavior test at a time for async dispatch and execution.**
- [ ] **Step 2: Verify each test fails for the missing await path.**
- [ ] **Step 3: Implement the smallest compatible async path.**
- [ ] **Step 4: Run targeted Gateway regressions.**
- [ ] **Step 5: Update product status, verify, commit and push.**

### Task 3: Complete HTTP/WebSocket administration and safe composition

**Files:**
- Modify: `src/modules/admin/gateway-routes.js`
- Modify: `apps/server/index.js`
- Modify: relevant API and integration tests

**Interfaces:**
- Consumes: Task 2 async Gateway Service.
- Produces: awaited administrator reads and a MySQL-only production composition after all business Stores have migrated.

- [ ] **Step 1: Add API tests that exercise asynchronous metadata and cancellation.**
- [ ] **Step 2: Verify RED, then implement the awaited route behavior.**
- [ ] **Step 3: Prohibit accidental mixed SQLite/MySQL production composition.**
- [ ] **Step 4: Run full MySQL and Gateway acceptance.**
- [ ] **Step 5: Update product status, verify, commit and push.**

## Self-review

- Task 1 establishes every method Task 2 and Task 3 require.
- No task introduces model direct calls, a secret, or a mixed production Store composition.
- No placeholders are used as an implementation instruction.
