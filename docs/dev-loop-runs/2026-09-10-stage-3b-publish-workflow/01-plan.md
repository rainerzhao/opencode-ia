# Stage 3B Publish Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or executing-plans task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deliver explicit, auditable private-draft to team-published knowledge and solution workflows.

**Architecture:** Extend the Content Store with status-transition versions, expose it through a focused `modules/content` router, then migrate the two React pages to the new REST shape with in-page confirmation. Legacy file routes remain compatibility endpoints.

**Tech Stack:** CommonJS Express, SQLite Store, React/Vite, Node test runner and browser acceptance.

**Spec:** `00-requirements.md` and the approved overall design section 7.

## Global Constraints

- Never expose a private body in list, search, audit or error output.
- Publish and withdraw are explicit state transitions that create versions; no implicit client visibility assignment.
- Only published team assets are readable by non-owners.
- No new dependencies, provider calls or Linux-ready claim.

### Task 1: Store publication transitions

**Files:** `src/content/content-store.js`, `test/content/content-store.test.js`

- [ ] Add failing tests showing publish creates a new team/published version and withdraw creates a private/withdrawn version, hiding the result from another member.
- [ ] Run `node --test test/content/content-store.test.js` and verify the missing transition API fails.
- [ ] Implement `publishKnowledge`, `withdrawKnowledge`, `publishSolution`, `withdrawSolution` by delegating through immutable save operations and return safe summaries.
- [ ] Re-run focused Store tests and verify PASS.

### Task 2: Authenticated content REST router

**Files:** `src/modules/content/routes.js`, `src/create-workbench-server.js`, `test/api/content-workflow.test.js`

- [ ] Add failing HTTP tests for private ownership, CSRF, audit-safe publishing and withdrawal visibility.
- [ ] Run `node --test test/api/content-workflow.test.js` and verify the route is absent.
- [ ] Register `/api/content`; map Store errors to stable 400/404/409 responses; record only safe audit metadata.
- [ ] Re-run focused HTTP tests and verify PASS.

### Task 3: React migration and product docs

**Files:** `apps/web/src/features/knowledge/KnowledgePage.jsx`, `apps/web/src/features/solutions/SolutionsPage.jsx`, `apps/web/src/styles.css`, `test/ui/react-features.test.js`, `README.md`, `docs/ROADMAP.md`

- [ ] Add failing UI feature tests for published/private status and explicit page confirmation controls.
- [ ] Migrate the pages to `/api/content/*`, retain simple authoring, and add accessible in-page confirmation (not browser `confirm`).
- [ ] Run focused UI tests, production build, and browser acceptance at desktop and mobile widths.
- [ ] Update product-facing stage status without calling Stage 3 complete.

### Task 4: Acceptance and release

- [ ] Run `npm test`, `npm run build`, `npm run check`, `npm run security:scan`, `git diff --check`.
- [ ] Record acceptance evidence, commit in Chinese and push `main`.
