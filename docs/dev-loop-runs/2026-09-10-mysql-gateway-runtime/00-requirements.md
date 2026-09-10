# Requirements Baseline

## Goal

Complete the MySQL Gateway persistence contract so the durable data layer can replace the historical SQLite Store without weakening private Conversation ownership, ordered events, recovery boundaries, or administrative metadata.

## Non-goals

- Do not compose MySQL Gateway with SQLite-backed Skill, knowledge, or solution Stores in the production server.
- Do not claim Linux deployment, production capacity, or OS-level sandboxing.

## User-visible Behavior

Existing product behavior remains unchanged. This delivery is the durable contract required before the Gateway runtime can safely be switched to MySQL.

## Acceptance Criteria

1. MySQL implements every Store operation already required by Gateway scheduling, recovery, Conversation management, and administrator job views.
2. Job binding only accepts a running Job and a Session belonging to the same Conversation and Worker.
3. All reads and writes preserve account ownership and event ordering.
4. A real MySQL 8.4 test verifies queue reconstruction, recovery sessions, binding, metadata, Conversation lifecycle, and restart semantics.

## Constraints

- MySQL 8.4 is the target business fact source; OpenCode remains the only Agent Runtime.
- No credential, provider endpoint, or database password is committed.
- The unrelated paused Stage 3C documents remain untouched.

## Assumptions

The user previously approved automatic phase progression and Chinese commits pushed to `main` after each verifiable phase.

## Open Questions

None. The approved MySQL single-source decision and Gateway boundaries determine this phase.

## Source Request

Continue the previously approved productization work without stopping between phases.

## Repo Context

`src/gateway/gateway-store.js` is the historical synchronous contract; `src/gateway/mysql-gateway-store.js` must provide the same durable semantics asynchronously.
