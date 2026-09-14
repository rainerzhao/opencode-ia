# P2D Dynamic Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the member home page a private, actionable summary of existing work without changing persistence, authorization, or OpenCode routing.

**Architecture:** Add a small pure snapshot helper inside `HomePage.jsx` that derives safe counts from owner-scoped API results. The page fetches four existing list endpoints in parallel after mount, presents derived metadata in action cards, and retains a resilient static fallback when a request fails. `WorkbenchShell` continues to own page navigation through its existing `go` callback.

**Tech Stack:** React 19, Vite, existing authenticated `request` client, Node test runner, React SSR tests, agent-browser.

**Spec:** `docs/dev-loop-runs/2026-09-14-p2d-dynamic-workbench/00-requirements.md`

## Global Constraints

- No new API, schema, Provider, or background Runtime behavior.
- Do not expose private titles, conversation event content, or cross-account data on the home page.
- Keep the editorial visual direction and maintain 390px no-overflow acceptance.
- Update README and roadmap only with verified Mac/browser evidence.

---

### Task 1: Prove and add the safe snapshot contract

**Files:**
- Modify: `test/ui/react-features.test.js`
- Modify: `apps/web/src/features/home/HomePage.jsx`

**Interfaces:**
- Produces: `deriveWorkbenchSnapshot({ requirements, conversations, knowledge, solutions })` returning `{ activeRequirements, clarifyingRequirements, activeConversations, privateDraftAssets }`.
- Produces: `HomePage({ go, initialData, fetcher })`, where `initialData` supports deterministic SSR tests and `fetcher` defaults to `request`.

- [ ] **Step 1: Write the failing test**

```js
test('home workbench summarizes only safe private work metadata and exposes next actions', async () => {
  await withViteModule('features/home/HomePage.jsx', ({ HomePage }) => {
    const html = renderToStaticMarkup(React.createElement(HomePage, {
      go: () => {},
      initialData: {
        requirements: [{ status: 'clarifying' }, { status: 'resolved' }],
        conversations: [{ id: 'conversation-1' }],
        knowledge: [{ status: 'draft', visibility: 'private' }],
        solutions: [{ status: 'published', visibility: 'team' }]
      }
    }));
    assert.match(html, /待推进需求/);
    assert.match(html, />1</);
    assert.match(html, /待澄清/);
    assert.match(html, /继续 AI 对话/);
    assert.doesNotMatch(html, /conversation-1/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ui/react-features.test.js`

Expected: FAIL because the old static home page has no `待推进需求` metric or `继续 AI 对话` action.

- [ ] **Step 3: Write minimal implementation**

```jsx
export function deriveWorkbenchSnapshot({ requirements = [], conversations = [], knowledge = [], solutions = [] } = {}) {
  const active = requirements.filter(({ status }) => ['draft', 'clarifying', 'in_progress'].includes(status));
  return {
    activeRequirements: active.length,
    clarifyingRequirements: active.filter(({ status }) => status === 'clarifying').length,
    activeConversations: conversations.length,
    privateDraftAssets: [...knowledge, ...solutions].filter((item) => item.visibility !== 'team' && item.status !== 'published').length
  };
}
```

Fetch each existing endpoint with `Promise.all`, normalize their response arrays, and render counts plus buttons that call the existing `go` callback. Render no item title/body values.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/ui/react-features.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/home/HomePage.jsx test/ui/react-features.test.js
git commit -m "feat: 增加动态个人工作台概览"
```

### Task 2: Refine the responsive action hierarchy and verify it in-browser

**Files:**
- Modify: `apps/web/src/styles.css`
- Modify: `test/ui/react-features.test.js` only if a semantic accessibility contract needs coverage

**Interfaces:**
- Consumes: semantic class names emitted by Task 1.
- Produces: desktop and 390px layouts with readable metric cards and no horizontal overflow.

- [ ] **Step 1: Write the failing test**

Extend the P2D SSR test to assert an accessible loading/status region and the `动态概览` landmark copy.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ui/react-features.test.js`

Expected: FAIL because the first Task 1 rendering lacks the new status contract.

- [ ] **Step 3: Write minimal implementation**

Use a compact two-level editorial layout: actionable dark priority card, quiet metric cards, and a low-contrast asset path. At 760px and below, stack cards and retain intrinsic sizing; do not create horizontal scrolling containers.

- [ ] **Step 4: Run targeted and production checks**

Run:

```bash
node --test test/ui/react-features.test.js
npm run build
npm run check
npm run security:scan
```

Expected: all pass.

- [ ] **Step 5: Browser acceptance**

Run `npm run demo`, log in with the ephemeral demo credentials, inspect the home page at desktop and 390px with agent-browser, click at least requirements and AI chat actions, and save screenshots under `artifacts/screenshots/`.

### Task 3: Record the product evidence and release the stage

**Files:**
- Modify: `README.md`
- Modify: `docs/ROADMAP.md`
- Create: `docs/dev-loop-runs/2026-09-14-p2d-dynamic-workbench/03-implementation-log.md`
- Create: `docs/dev-loop-runs/2026-09-14-p2d-dynamic-workbench/04-acceptance-report.md`
- Create: `docs/dev-loop-runs/2026-09-14-p2d-dynamic-workbench/05-pr-summary.html`

**Interfaces:**
- Consumes: verified Task 1–2 output only.
- Produces: a truthful P2D delivery record and product-facing README status.

- [ ] **Step 1: Record exact commands, output summaries, browser evidence, and boundaries.**
- [ ] **Step 2: Update README and roadmap to state P2D is Mac/Demo browser verified, not company production verified.**
- [ ] **Step 3: Run `git diff --check`, inspect the staged file list, commit with a Chinese message, and push `main`.**
