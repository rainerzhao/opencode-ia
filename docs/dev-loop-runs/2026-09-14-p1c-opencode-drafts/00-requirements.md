# Requirements Baseline — P1C-B OpenCode Requirement Drafts

## Goal

Let a member explicitly request a structured private requirement draft from an owned Conversation. The request must execute through the existing Gateway/OpenCode worker and the result must remain a draft until the member confirms a new private requirement.

## Non-goals

- No direct internal-provider or OpenAI-compatible API call from browser/backend.
- No automatic requirement creation, publishing, sharing, BU selection, or asset disclosure.
- No implicit submission on every conversation message.
- No new per-user Runtime/process; jobs use the existing fair queue and Conversation-to-OpenCode-session mapping.

## User-visible Behavior

1. A member selects an owned active Conversation and an explicit inclusive source-event sequence range.
2. The service captures a private source digest/range, creates a `generating` draft, and submits a controlled JSON-only request to the existing Gateway.
3. The member polls the draft; once the Gateway job is terminal, the system extracts and strictly validates the assistant JSON. Invalid output becomes a failed draft and never a requirement.
4. A ready draft presents AI-proposed core text and typed field values plus `needsClarification`; the member supplies/edits final data and explicitly confirms.
5. Confirmation creates a new private requirement and records the resulting ID on the draft. Rejecting preserves the draft and source provenance without creating a requirement.

## Acceptance Criteria

1. SQLite/MySQL have matched drafts tables with owner, source Conversation/range/digest, Gateway job, status, structured JSON, terminal failure code and confirmed requirement ID.
2. Every generation request calls `gatewayService.submit`; no direct model client exists in the feature code.
3. Only the owner can create/read/list/confirm/reject a draft; administrators receive no private source/draft body.
4. Reconciliation is idempotent and reads only the job's own Gateway events.
5. Generated JSON must match the contract and active controlled templates. Missing fact handling must be explicit through `needsClarification`, not invented values.
6. Confirmation is explicit, owner-only and creates a private requirement through the existing repository validation path.
7. Tests cover OpenCode/Gateway submission, invalid JSON, source mismatch, owner isolation, no automatic persistence, confirmation and rejection.

## Constraints

- Source raw text is not copied to audit metadata or the draft table; only a SHA-256 digest and sequence range are stored as provenance. The existing Gateway history retains conversation content under its owner boundary.
- A source range is at most 1,000 events to give bounded server work. Complete conversation history stays accessible via its existing paginated endpoint.
- The draft prompt does not inject raw source history; the bound OpenCode Conversation already owns its own context.
- Production needs MySQL runtime evidence; SQLite is local/test compatible.

## Assumptions

- A draft may propose title, scenario, description, controlled field values and clarification questions; the user chooses the BU at confirmation.
- A completed Gateway job emits one consolidated `message.delta` event, as the current Gateway implementation does.
- P2 will surface this API in the redesigned workbench; this backend stage introduces no visual UI.
