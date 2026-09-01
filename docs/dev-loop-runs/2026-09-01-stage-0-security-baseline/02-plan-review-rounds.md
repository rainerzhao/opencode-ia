# Plan Review Rounds

## Round 1 — Controller self-review

### Scope and dependency review

- Stage 0 is independently testable and does not depend on the future React, SQLite business model, or persistent OpenCode Gateway implementation.
- Tasks are serial because Task 2 consumes Task 1 configuration, Task 3 consumes Task 2 runner, and Task 4 consumes Task 1 path policy plus Task 3 server factory.
- Task 5 can only declare the full suite green after Tasks 1–4 provide tests.
- Task 6 consumes all implementation and produces acceptance evidence.

### Spec coverage

- Security stopgap requirements are covered by Tasks 1–5.
- Browser and evidence requirements are covered by Task 6.
- Full product features intentionally remain in later stage plans and are listed as non-goals in the requirements baseline.

### Test review

- Production behavior changes use RED/GREEN steps.
- Process tests use real child processes rather than spawn mocks.
- API and WebSocket tests use real ephemeral servers.
- Filesystem tests use temporary roots and hand-derived literal expectations.
- Real paid model calls are excluded from the ordinary suite.

### Risk review

- Refactoring the server factory is the highest regression risk; it is preceded by lifecycle characterization and followed by route and WebSocket integration tests.
- URL import becomes deny-by-default, which is an intentional safe behavior change and is documented.
- The currently exposed Provider credential cannot be rotated in code; the plan removes copies, blocks recurrence, and records the operator action.
- Git commits are excluded until the user separately authorizes them.

### Findings resolved during self-review

- **IMPORTANT — symbolic-link escape:** lexical `path.resolve` containment would still allow an existing in-root symlink to target an outside directory. Task 1 now requires real-path validation for existing targets and the nearest existing ancestor of new write targets, plus a symlink regression test.
- **IMPORTANT — URL redirect escape:** validating only the initial URL would allow an authorized host to redirect to an unauthorized target. Task 4 now requires manual redirect handling, validation of every target, a five-hop cap, and a real redirect regression test.
- **IMPORTANT — plan placeholder:** the server entrypoint example previously contained an unspecified configuration comment. It now contains the exact `createPromptRunner` arguments.
- **NIT — test discovery portability:** the npm test script no longer depends on shell-specific recursive glob expansion; Node's built-in test discovery is used directly.

## Verdict

APPROVED for user execution-mode review. No unresolved BLOCKER, IMPORTANT, or QUESTION items in the plan text.
