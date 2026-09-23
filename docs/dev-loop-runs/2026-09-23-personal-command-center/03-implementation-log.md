# Implementation Log

Base: `bcf7155` on `main`.

## Task 1 — View model and semantic command center

- Wrote failing SSR and view-model tests first; failures proved the greeting, five signals, real owner-visible work rows and `buildWorkbenchView` were absent.
- Implemented bounded, priority-sorted requirement, clarification, conversation and milestone views without rendering bodies.
- Added a second RED/GREEN regression proving the clarification total is not capped by the four-row display limit.
- Focused result: 2 home tests pass; full React feature result before the count fix: 25/25 pass.

## Task 2 — Stable desktop composition

- Replaced irregular spanning cards with a named 12-column operations grid at wide desktop and a deliberate two-column layout at the 1024px minimum.
- Added aligned five-signal cards, a real requirement table, clarification list, asset lifecycle, active conversation strip and milestone timeline.
- Centered the max-width workspace inside large displays and kept OpenCode Runtime visually subordinate.

## Browser evidence

- `home-1440-empty.png`: empty state, 1440×1000.
- `home-1440-populated.png`: four requirements and three conversations, 1440×1000.
- `home-1024-populated.png`: same owner-scoped data, 1024×900.
- DOM result at both widths: `document.body.scrollWidth === document.body.clientWidth`.
- Keyboard result: first Tab reached `工作台首页` with `2px solid rgb(22, 127, 134)` and `3px` outline offset.
- Tool note: the installed legacy `agent-browser` restarts its session on viewport change; reopening and re-authenticating restored the intended 1024px evidence.

## Review and fix pass

- Inline product/privacy/code review found no cross-owner data path: all four home APIs retain their existing owner-scoped contracts and the component never renders bodies.
- IMPORTANT finding fixed with RED/GREEN: when only a conversation exists, the dominant next action now routes to `chat` instead of `requirements`.
- IMPORTANT count boundary fixed with RED/GREEN: the clarification metric reports the full total while the list remains bounded to four rows.
- IMPORTANT accessibility finding fixed with RED/GREEN: clickable requirement rows retain native button semantics instead of being overridden by an incomplete ARIA table role.
- Final gate: 416 tests, 392 pass, 0 fail, 24 explicit real-environment skips; build, JavaScript check, secret scan and `git diff --check` all exit 0.
