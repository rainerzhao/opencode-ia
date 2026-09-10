# Stage 4D Acceptance Report

## Result

**Stage 4D is complete for Mac application-level acceptance.** It does not establish Linux production readiness.

## Requirement matrix

| Requirement | Evidence | Result |
| --- | --- | --- |
| Private successor cannot replace a public release | Store and HTTP governance tests; catalog regression test | Pass |
| Validated successor becomes active while history remains rollbackable | Store, API and service tests | Pass |
| Member upgrade/rollback is isolated and revalidates | Installation-service and API tests | Pass |
| Package replacement is atomic and compensated | Installation files/service tests | Pass |
| Disable stops discovery; archive retains history | Store/API tests and real OpenCode acceptance | Pass |
| Runtime does not reuse stale Skill cache after selection changes | Gateway workspace-key/rebinding test plus real OpenCode acceptance | Pass |
| Desktop/mobile product experience | Isolated Demo at 1440×900 and 390×844; no body horizontal overflow or browser errors | Pass |

## Fresh verification

- Focused regression: 25 tests passed across store, API, UI and publish/install suites after the final catalog-resolution fix.
- Gateway unit suite: 27 tests passed, including a Conversation rebinding to a fresh workspace after the enabled Skill set changes.
- `npm run test:skill-version-discovery`: passed against real OpenCode `1.18.25`. It confirmed 0.2.0 after upgrade, 0.1.0 after rollback, no discovery for a second member, and no discovery in a fresh managed workspace after disable.
- `npm run build`: passed (40 transformed modules).
- `npm run check`: passed (116 JavaScript files).
- `npm run security:scan` and `git diff --check`: passed.
- Browser: isolated full-stack Demo at 1440×900 and 390×844 reported `bodyOverflow: false` and no browser errors. See `artifacts/screenshots/stage-4d-desktop.png` and `artifacts/screenshots/stage-4d-mobile-final.png`.

## Production boundary

Remaining work is unchanged: Stage 3 knowledge/solution publication workflow, then Stage 5 Linux non-root deployment, internal Provider integration, OS-level process sandboxing, monitoring, backup/restore, long-duration capacity testing and release rollback procedure.
