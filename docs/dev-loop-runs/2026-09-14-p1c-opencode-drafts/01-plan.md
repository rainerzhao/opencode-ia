# P1C-B OpenCode Requirement Drafts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn an explicitly selected private Conversation range into a validated draft via the existing Gateway/OpenCode path, then require owner confirmation before creating a requirement.

**Architecture:** Requirement repositories persist provenance and draft state; a thin `RequirementDraftService` orchestrates store, Gateway and Conversation event read APIs. It submits an ordinary, auditable Gateway job in the existing Conversation, reconciles only that job's terminal output, and delegates final requirement validation/creation to the existing requirement repository.

**Tech Stack:** Node.js CommonJS, Express, existing OpenCode Gateway/worker pool, SQLite/MySQL, node:test.

**Spec:** `docs/dev-loop-runs/2026-09-14-p1c-opencode-drafts/00-requirements.md`

## Task Sequence

1. Add version-14 SQLite/MySQL migration and strict draft-input/output normalizer; write red tests.
2. Add matching SQLite/MySQL private draft repository methods with idempotent terminal reconciliation state transitions.
3. Add `RequirementDraftService`, submitted only through `gatewayService.submit`, with bounded source-range digest, job-scoped output extraction and JSON validation.
4. Add authenticated HTTP routes, audit-safe metadata and integration tests with a fake Gateway service.
5. Run focused + full applicable tests, update product docs, commit and push.

## Key Risks and Controls

- **Model output is untrusted:** parse only a bounded JSON object; reject markdown fences, unknown fields, wrong field IDs/types and missing clarification list.
- **Repeated polling:** terminal reconciliation checks stored status/job status and is idempotent.
- **Draft-to-requirement race:** confirmation records the created requirement ID and returns it for repeat confirmation; require explicit final body including BU.
- **Context overreach:** source range records provenance but the controlled prompt never copies arbitrary event bodies into a second provider request.
