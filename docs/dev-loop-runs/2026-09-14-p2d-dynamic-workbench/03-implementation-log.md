# Implementation Log

## Scope

P2D converts the existing static member homepage into a private, actionable summary. It does not add an API, database migration, Provider call, Runtime behavior, or sharing path.

## TDD evidence

1. Added `home workbench summarizes only safe private work metadata and exposes next actions` to `test/ui/react-features.test.js`.
2. Ran `node --test test/ui/react-features.test.js` before the implementation: **22 pass, 1 fail**. The failure was expected: the old homepage did not render `待推进需求`.
3. Added `deriveWorkbenchSnapshot` and the minimal `HomePage` fetch/render path.
4. Re-ran the same command: **23 pass, 0 fail**.

## Implementation

- `HomePage` reads only existing authenticated list endpoints after mount:
  - `/api/requirements`
  - `/api/conversations?status=active&limit=100`
  - `/api/content/knowledge`
  - `/api/content/solutions`
- The page derives counts from status/visibility metadata only. It never renders returned titles, event content, document markdown, solution markdown, or prompts.
- It counts active requirements (`draft`, `clarifying`, `in_progress`), clarifying requirements, active Conversations, and non-team/non-published personal content.
- Four action cards use the shell's existing `go(pageId)` navigation. They do not introduce a second router or hidden mutation.
- Loading and read failure states retain main navigation and explain the limitation without exposing backend error details.
- CSS adds a compact editorial metric hierarchy. A browser finding showed the hero decoration pseudo-element made the internal card `scrollWidth` wider than its container at 390px; its position was corrected so both document and card have no overflow.

## Verification commands

| Command | Result |
| --- | --- |
| `node --test test/ui/react-features.test.js` | 23 pass, 0 fail |
| `npm run build` | passed; Vite production bundle built |
| `npm run check` | passed |
| `npm run security:scan` | passed |
| `git diff --check` | passed |

## Browser evidence

- Isolated no-key Demo on `http://127.0.0.1:4335`, signed in as ephemeral `demo-admin`.
- Desktop: dynamic overview and all four action cards were present; `打开需求流` navigated to the existing requirement workspace.
- 390px: after the overflow correction, `documentElement.scrollWidth === clientWidth === 390` and the focused overflow scan returned an empty list.
- Screenshots: `artifacts/screenshots/p2d-workbench-desktop-final.png` and `artifacts/screenshots/p2d-workbench-mobile-fixed.png`.

## Boundary

This evidence is local/Demo browser evidence. It does not validate a company Provider, cloud MySQL, Linux process isolation, real 20-user model concurrency, long-running stability, backup recovery, or production launch.
