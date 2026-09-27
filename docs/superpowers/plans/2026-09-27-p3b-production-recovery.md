# P3B Production Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the production-path acceptance Harness with real OpenCode Worker crash recovery and MySQL-backed history verification after a full workbench restart.

**Architecture:** Keep the capacity-only command unchanged. A second command enables an additional recovery phase in the same fresh acceptance database, kills the sticky worker for an active job, verifies restart and explicit recovery semantics, then recreates the production workbench and reads history through authenticated HTTP.

**Tech Stack:** Node test runner, MySQL 8.4, OpenCode Worker Pool, HTTP/WebSocket.

**Spec:** `docs/PRODUCT_GOAL.md`

## Global Constraints

- Linux/TLS/dedicated acceptance database and production/provider gates remain mandatory.
- No database reset, API/schema change or secret-bearing output.
- Capacity-only command never injects faults.
- Both session restoration and explicit recovery boundary are valid; silent replay is not.

## Review Focus

- Kill only the worker attached to the selected running job.
- Observe a new healthy process before evaluating the queued job.
- Never include numeric process ids in diagnostic evidence.
- Recreate the full production workbench against the same database/data roots.
- Count terminal events after restart so interrupted work is not mistaken for missing history.

### Task 1: Command contract

- [x] Add failing deployment-contract assertions for the new command and recovery markers.
- [x] Run RED.
- [x] Add the exact command and recovery phase gate.
- [x] Run GREEN.

### Task 2: Runtime crash and workbench restart

- [x] Add failure injection after the capacity phase.
- [x] Verify interrupted active work, replaced process, restored context or recovery boundary.
- [x] Recreate the workbench and verify authenticated MySQL history.
- [x] Verify default skip and Mac fail-closed behavior.

### Task 3: Handoff

- [x] Update product and operations documents without closing P3B.
- [x] Run all quality gates and record evidence.
- [ ] Commit, push and verify remote main.
