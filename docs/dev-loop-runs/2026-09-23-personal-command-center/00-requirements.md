# Requirements Baseline

## Goal

Replace the low-density, uneven-card home page with a coherent desktop command center based on the approved reference image, while preserving owner-scoped privacy and the OpenCode runtime boundary.

## Non-goals

- No mobile or tablet layout.
- No new backend data model, provider path or external visual dependency.
- No invented production readiness, customer data or runtime metrics.
- No broad redesign of every feature page in this increment.

## User-visible Behavior

- The home page has a stable greeting/context band, one dominant next action, five aligned signals, and a 12-column operations grid.
- The requirement queue contains the current member's real titles, BU/status/update metadata and a direct action.
- Clarification, active conversation, asset lifecycle and milestone regions remain useful in zero/loading/error states.
- OpenCode Runtime remains a low-noise system status rather than the page hero.

## Acceptance Criteria

1. The server-rendered home exposes the five signal labels and the approved operational regions.
2. Owner-scoped requirement and conversation titles render on the personal page; content from data not passed to the page cannot appear.
3. The home layout has no page-level horizontal overflow at 1440x1000 or 1024x900.
4. Primary actions are keyboard reachable with visible focus.
5. Focused UI tests, full tests, build, check, secret scan and diff check pass.
6. README describes the product experience and verified local scope without claiming company production readiness.

## Constraints

- Desktop-first 1280-1920px; minimum supported width 1024px.
- React/Vite and existing CSS architecture only.
- No public font, icon, analytics or image dependency.
- Current authenticated user may see their own private titles; team/admin aggregation may not.
- Existing unrelated untracked files remain untouched.

## Assumptions

- Existing requirement, conversation, knowledge and solution list APIs are owner-scoped.
- Missing deadline/owner/progress fields are represented honestly with status and update metadata rather than fabricated values.
- The earlier instruction to continue stage-by-stage authorizes native automatic execution, verification, README update, Chinese commit and push.

## Open Questions

None blocking. Backend support for explicit due dates and reminders remains a later product increment.

## Source Request

The current frontend feels low quality: cards have inconsistent sizes and the page has no usable working flow. Use the supplied command-center reference as the new baseline.

## Repo Context

- Base commit: `bcf7155`
- Branch: `main`, tracking `origin/main`
- Existing unrelated untracked files are listed by `git status` and excluded from all staging commands.
- Execution mode: native/automatic; inline review because agent delegation is not authorized for this request.
