# Stage 1 Acceptance Report

## Current Verdict

**Stage 1A: PASS**
**Stage 1B: PASS**
**Stage 1C: PASS**
**Whole Stage 1: IN PROGRESS**

## Scope Checked

- SQLite lifecycle, pragmas, schema, migration idempotency, rollback and compatibility guard.
- Password hashing and verification behavior.
- User, Session and audit persistence boundaries.
- First-administrator bootstrap invariants and CLI secret handling.
- Login, logout, current-user, password-change and Session invalidation behavior.
- Cookie attributes, CSRF triple match, login limiting and generic authentication errors.
- Administrator account creation, listing, password reset, status control and Session revocation.
- Business REST authentication, CSRF, admin/member role checks and private ownership filters.
- WebSocket Cookie authentication, same-origin enforcement, identity binding and revocation revalidation.
- Private solution/knowledge filesystem modes and actor-attributed, content-safe audit events.
- Regression coverage for the existing Stage 0 HTTP, WebSocket, OpenCode, file, upload, URL and Demo boundaries.

## Reviewers Run

- Requirements acceptance: PASS for Stage 1A, Stage 1B and Stage 1C.
- Test coverage: PASS; all new behavior has observed RED→GREEN evidence.
- Code quality: PASS; focused modules replace adding database responsibilities to the existing server file.
- Security: PASS; no production default credentials, password arguments, plaintext Session/CSRF storage, cross-origin WebSocket access or secret scan findings.
- Docs/migration: PASS; database path, operator command, current phase and limitation are documented.

## Tests Run

- `npm test`: 111 tests passed, 0 failed.
- `npm run check`: 53 JavaScript files passed.
- `npm run security:scan`: zero findings.
- `git diff --check`: passed.
- Latest browser report remains the Stage 1B desktop/mobile documentation check; Stage 1C changes only backend contracts, and Stage 1D owns authenticated browser acceptance.
- Real CLI child-process test and real temporary SQLite file tests passed.

## Requirement Coverage

- Acceptance criterion 1: complete for schema version 1.
- Acceptance criterion 2: complete for password and hash-only Session/CSRF persistence.
- Acceptance criteria 3–4: complete at the authentication/admin API boundary.
- Acceptance criterion 5: complete for account management and current business write audit events.
- Acceptance criterion 6: complete for current REST/WebSocket and filesystem-backed solution/knowledge boundaries.
- Acceptance criterion 7: remains assigned to Stage 1D browser login and account-management acceptance.
- Acceptance criterion 8: Stage 1A verification complete; Git commit/push recorded after release.

## Findings

No unresolved `BLOCKER`, `IMPORTANT` or `QUESTION` findings for Stage 1A, Stage 1B or Stage 1C.

## Fixes Applied

- Added a compatibility guard so older code refuses databases with newer migration versions.
- Forced account database files to owner-only mode `0600` instead of relying on the process `umask`.
- Rejected control characters in display names before they can reach future UI or audit surfaces.
- Kept first-admin creation atomic with its audit event.
- Prohibited password command arguments and excluded password values from output.
- Prevented a successful login from clearing the source-IP failure history used to resist distributed username attempts.
- Added `Cache-Control: no-store` across authentication and administrator routes.
- Required authentication on all business REST/WebSocket entry points and CSRF on all business writes.
- Added same-origin WebSocket validation and per-message Session revalidation after revocation.
- Forced private content directories/files to `0700/0600` and removed OpenCode working-directory disclosure.
- Fixed private/shared knowledge tree merging so private files do not hide unrelated shared documents.

## Residual Risks

- Behind a future reverse proxy, source IP extraction requires an explicit trusted-proxy design before Linux production use.
- The static frontend cannot yet establish the new authenticated API/Socket session; browser login and account UI arrive in 1D.
- The current filesystem ownership layer is a Stage 1 bridge; versioned publication and richer cross-owner administration arrive with Stage 3 metadata.
- React/Vite migration and Stage 1 release gate remain in 1E.

## Follow-ups

Complete Stage 1C Git delivery, then start Stage 1D frontend login and authenticated browser acceptance.
