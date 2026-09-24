# P2E Desktop Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved desktop mission-control visual system across the workbench, with the shell, home and requirements pages as the reference implementation and every existing workspace visually aligned.

**Architecture:** Split the current global stylesheet into semantic design, shell and feature-owned CSS modules imported by one manifest. Preserve all existing React data flows and API contracts; add semantic markup only where the approved layout needs it. Validate behavior with server-rendered React contracts and validate appearance in the real Demo at 1440px and 1024px.

**Tech Stack:** React 19, Vite 7, plain CSS, Node test runner, agent-browser.

**Spec:** `docs/superpowers/specs/2026-09-22-p2e-desktop-workbench-design.md`

## Global Constraints

- Primary viewport range is 1280–1920px; 1024px is the minimum usable width.
- OpenCode remains the only Agent Runtime and the browser does not call a Provider.
- Preserve APIs, WebSocket events, authentication, CSRF, ownership, audit and MySQL behavior.
- No public font CDN, external image service, analytics, or runtime design-system dependency.
- The authenticated member may see titles returned by owner-scoped endpoints on their personal home; bodies and another member's private content never appear in home, administrator or team summaries.
- Demo, Mac and CI evidence must not be presented as company production verification.

## Review Focus

- A 1024px viewport must retain the navigation rail and expose every primary action without page-level horizontal overflow; Task 1 and Task 5 verify this.
- Long Chinese titles and BU names must wrap or truncate within record rails without hiding state; Task 3 verifies the markup and Task 5 verifies the browser result.
- Keyboard users must see focus and follow navigation → header → workspace order; Task 1 and Task 5 verify this.
- Empty, loading, error and populated states must remain readable against the new palette; Tasks 2–4 cover the state markup and Task 5 checks the Demo.
- Styling changes must not expose private content or remove lifecycle actions; Tasks 2–4 retain the current behavior contracts and the full test suite verifies them.

---

### Task 1: Design Foundation and Desktop Shell

**Files:**
- Create: `apps/web/src/design/tokens.css`
- Create: `apps/web/src/design/foundation.css`
- Create: `apps/web/src/shell/workbench-shell.css`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/shell/WorkbenchShell.jsx`
- Modify: `test/ui/react-build.test.js`
- Modify: `test/ui/react-features.test.js`

**Interfaces:**
- Produces: semantic CSS tokens `--wb-*`, reusable classes `.wb-*`, and shell landmarks/classes consumed by every later task.
- Preserves: `WorkbenchShell({ user, onLogout })`, page ids and `setPage` navigation behavior.

- [x] **Step 1: Add failing source-contract tests**

Add assertions that the three new CSS files exist, `styles.css` imports them, the shell renders grouped navigation and a `main` workspace landmark, and no CSS contains remote `url(http...)` resources.

- [x] **Step 2: Run the focused tests and verify RED**

Run: `node --test test/ui/react-build.test.js test/ui/react-features.test.js`

Expected: FAIL because the design files and shell markers do not exist.

- [x] **Step 3: Implement the foundation and shell**

Create the semantic tokens and focus/field/button primitives. Rewrite `WorkbenchShell.jsx` into readable JSX with navigation groups, context header and persistent runtime footer. Convert `styles.css` into the import manifest while retaining legacy feature rules until their owning tasks replace them.

- [x] **Step 4: Run focused tests and build**

Run: `node --test test/ui/react-build.test.js test/ui/react-features.test.js && npm run build`

Expected: PASS; Vite emits a self-contained CSS asset without remote resources.

- [x] **Step 5: Commit**

```bash
git add apps/web/src/design apps/web/src/shell apps/web/src/styles.css test/ui/react-build.test.js test/ui/react-features.test.js
git commit -m "feat: 建立 P2E 桌面工作台设计系统"
```

### Task 2: Personal Command Home

**Files:**
- Create: `apps/web/src/features/home/home.css`
- Modify: `apps/web/src/features/home/HomePage.jsx`
- Modify: `apps/web/src/styles.css`
- Modify: `test/ui/react-features.test.js`

**Interfaces:**
- Consumes: Task 1 `.wb-*` primitives and existing owner-scoped requirements, conversations, knowledge and solutions endpoints.
- Produces: a task-first personal command center with real owner-visible work rows, bounded operational lists and navigation actions.

- [x] **Step 1: Add a failing home contract**

Require the rendered page to contain the greeting, `下一步要做`, five work signals, `待推进需求`, `待澄清`, `进行中协作`, `资产沉淀`, `近期里程碑`, and `OpenCode Runtime`. Owner-scoped titles render, while supplied private bodies remain absent.

- [x] **Step 2: Verify RED**

Run: `node --test --test-name-pattern="home workbench" test/ui/react-features.test.js`

Expected: FAIL on the new approved labels/regions.

- [x] **Step 3: Implement the command home**

Expand the pure home view model and replace the hero/card composition with a compact briefing, one dominant next action, five signals, a real requirement table, clarification queue, asset lifecycle, active conversations, milestones and low-emphasis Runtime status.

- [x] **Step 4: Verify GREEN**

Run: `node --test --test-name-pattern="home workbench" test/ui/react-features.test.js && npm run build`

Expected: PASS with owner titles present, bodies absent and bounded list/count behavior verified.

- [x] **Step 5: Commit**

```bash
git add apps/web/src/features/home apps/web/src/styles.css test/ui/react-features.test.js
git commit -m "feat: 重构个人任务工作台首页"
```

### Task 3: Requirements Operations Workspace

**Files:**
- Create: `apps/web/src/features/requirements/requirements.css`
- Modify: `apps/web/src/features/requirements/RequirementsPage.jsx`
- Modify: `apps/web/src/styles.css`
- Modify: `test/ui/react-features.test.js`

**Interfaces:**
- Consumes: Task 1 workspace grid and status tokens; current requirements REST behavior remains unchanged.
- Produces: semantic record rail, detail timeline and next-action pane, with the same create/edit/filter/communication/asset/draft actions.

- [x] **Step 1: Add failing requirements contracts**

Require `需求作战台`, `需求队列`, `事实与证据`, and `推进控制` regions, a current-state text label, long-title-safe element markers, and all existing privacy/communication/asset actions.

- [x] **Step 2: Verify RED**

Run: `node --test --test-name-pattern="requirement workbench|requirement detail|requirement draft" test/ui/react-features.test.js`

Expected: FAIL on the new region labels/classes.

- [x] **Step 3: Implement the requirements workspace**

Refactor only presentation markup and small view helpers. Preserve every request function and form field name. Add a dense filter command row, semantic list items, a center evidence pane, and a 1024px fallback that moves the action pane below the detail.

- [x] **Step 4: Verify GREEN**

Run: `node --test --test-name-pattern="requirement workbench|requirement detail|requirement draft" test/ui/react-features.test.js && npm run build`

Expected: PASS; all existing requirement lifecycle controls remain present.

- [x] **Step 5: Commit**

```bash
git add apps/web/src/features/requirements apps/web/src/styles.css test/ui/react-features.test.js
git commit -m "feat: 重构需求与场景作战台"
```

### Task 4: Align AI, Asset, Skill and Admin Workspaces

**Files:**
- Create: `apps/web/src/features/chat/chat.css`
- Create: `apps/web/src/features/assets/assets.css`
- Create: `apps/web/src/features/admin/admin.css`
- Modify: `apps/web/src/features/chat/ChatPage.jsx`
- Modify: `apps/web/src/features/solutions/SolutionsPage.jsx`
- Modify: `apps/web/src/features/knowledge/KnowledgePage.jsx`
- Modify: `apps/web/src/features/skills/SkillsPage.jsx`
- Modify: `apps/web/src/features/admin/AdminPage.jsx`
- Modify: `apps/web/src/styles.css`
- Modify: `test/ui/react-features.test.js`

**Interfaces:**
- Consumes: Task 1 primitives and Tasks 2–3 visual language.
- Produces: consistent workspace framing without altering component public props or business actions.

- [x] **Step 1: Add failing cross-workspace contracts**

Require an explicit contextual collaboration heading and lifecycle labels for solution, knowledge, Skill and administration surfaces. Assert the existing publish/install/enable/version/account controls still render.

- [x] **Step 2: Verify RED**

Run: `node --test test/ui/react-features.test.js`

Expected: FAIL on the new semantic page framing.

- [x] **Step 3: Implement aligned workspaces**

Add page headers and shared asset workspace classes, then move visual rules into the three feature CSS files. Keep chat event handling, asset lifecycle actions, Skill validation and administrator operations unchanged.

- [x] **Step 4: Verify GREEN**

Run: `node --test test/ui/react-features.test.js && npm run build`

Expected: PASS; all user-visible lifecycle actions remain available.

- [x] **Step 5: Commit**

```bash
git add apps/web/src/features apps/web/src/styles.css test/ui/react-features.test.js
git commit -m "feat: 统一 AI 与团队资产工作区体验"
```

### Task 5: Desktop Browser Acceptance and Product Handoff

**Files:**
- Create: `docs/dev-loop-runs/2026-09-22-p2e-desktop-workbench/04-acceptance-report.md`
- Create: `docs/dev-loop-runs/2026-09-22-p2e-desktop-workbench/artifacts/screenshots/`
- Modify: `README.md`
- Modify: `docs/PRODUCT_GOAL.md`
- Modify: `docs/ROADMAP.md`

**Interfaces:**
- Consumes: the complete P2E UI from Tasks 1–4.
- Produces: browser evidence and truthful project status for maintainers and colleagues.

- [x] **Step 1: Run the automated quality gate**

Run: `npm test && npm run build && npm run check && npm run security:scan && git diff --check`

Expected: all non-environment tests pass; any real OpenCode-only skips are named in the report.

- [x] **Step 2: Run the Demo and browser acceptance**

At 1440×1000 visit all seven destinations. At 1024×900 visit home, requirements, AI, Skills and administration. Verify no page-level horizontal overflow, visible focus, working navigation and populated/empty states. Save screenshots under the task artifact directory.

- [x] **Step 3: Record evidence and update product documents**

Document the exact viewports, paths, actions and limitations. Mark P2E complete only for local desktop browser acceptance; keep company Linux, Provider and production gates pending.

- [ ] **Step 4: Commit and push**

```bash
git add README.md docs/PRODUCT_GOAL.md docs/ROADMAP.md docs/dev-loop-runs/2026-09-22-p2e-desktop-workbench
git commit -m "docs: 完成 P2E 桌面工作台验收"
git push origin main
```

- [ ] **Step 5: Verify remote state**

Run: `git fetch origin main && test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"`

Expected: exit 0 and the Linux verification run for `HEAD` succeeds.
