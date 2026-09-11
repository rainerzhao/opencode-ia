# Requirements Baseline

## Goal

Implement a MySQL 8.4 Content Store with the established knowledge and solution contract, so content metadata, immutable versions, publication state and source references can move off the historical SQLite runtime.

## Non-goals

- Do not yet compose the production server with a MySQL Content Store.
- Do not migrate Skill persistence or declare a MySQL-only application complete.
- Do not claim Linux deployment, production capacity, backup readiness or OS-level sandboxing.

## User-visible Behavior

Content continues to be private by default. Owners and administrators retain their existing access; team members see only explicitly published team content. Publish and withdraw create immutable versions and source references remain attached to solution versions.

## Acceptance Criteria

1. A real MySQL 8.4 test creates, versions, publishes and withdraws knowledge and solutions through the asynchronous Store.
2. A member cannot read or search another member's private content, while published team content remains discoverable.
3. Current-version state, immutable history, references, status and visibility are transactionally consistent.
4. Input validation and not-found behavior retain the existing content Store error codes.

## Constraints

- MySQL is the target business fact source; OpenCode remains the only Agent Runtime.
- No credentials, Provider settings or private content enter source control or audit documentation.
- The untracked Stage 3C provenance documents are outside this phase and must remain untouched.

## Assumptions

The existing MySQL migration v5 is the durable schema baseline. Its JSON tags, version pointers, source-reference uniqueness and ngram index are already covered by database migration tests.

## Open Questions

None. The prior single-source MySQL decision and existing content contract define this implementation.

## Source Request

Continue the approved productization roadmap automatically, committing and pushing each verified phase.

## Repo Context

`src/content/content-store.js` is the synchronous SQLite behavioral reference. `src/modules/content/routes.js` now accepts asynchronous Stores and is the intended HTTP boundary for this repository.
