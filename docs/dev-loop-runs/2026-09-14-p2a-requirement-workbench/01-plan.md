# P2A 需求与场景工作台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让成员在浏览器中创建、组织、筛选、编辑并持续记录默认私有的 BU 需求资产。

**Architecture:** 增加 feature-local 的 `RequirementsPage`，通过既有 `request()` 访问 `/api/requirements` 系列接口。页面使用列表、详情和行动区分离发现、阅读、写入状态；HomePage 仅使用需求列表产生个人概览，不复制服务端业务逻辑。

**Tech Stack:** React 19、Vite、Express Requirement Router、node:test、react-dom/server。

**Spec:** `docs/dev-loop-runs/2026-09-14-p2a-requirement-workbench/00-requirements.md`

## Global Constraints

- 需求内容默认私有；不为方便展示而放宽 API 或复制原始内容。
- 不改变 P1C 数据模型及所有既有页面的公开行为。
- 样式不能依赖公网字体、CDN 或图片。
- 每一项行为变更先得到一个预期失败的自动化测试。

---

### Task 1: 需求页路由与静态界面契约

**Files:**
- Create: `apps/web/src/features/requirements/RequirementsPage.jsx`
- Modify: `apps/web/src/shell/WorkbenchShell.jsx`
- Modify: `test/ui/react-features.test.js`
- Modify: `test/ui/react-build.test.js`

**Interfaces:**
- Produces `RequirementsPage({ initialRequirements, initialBusinessUnits, initialFieldTemplates })`。
- 壳层新增页面 key `requirements`。

- [ ] **Step 1: Write the failing test**

```js
await withViteModule('features/requirements/RequirementsPage.jsx', ({ RequirementsPage }) => {
  const html = renderToStaticMarkup(React.createElement(RequirementsPage, {
    initialRequirements: [{ id: 'req-1', title: '门店网络改造', buName: '零售 BU', status: 'clarifying', updatedAt: '2026-09-14T08:00:00.000Z' }],
    initialBusinessUnits: [{ id: 'bu-1', name: '零售 BU' }]
  }));
  assert.match(html, /我的需求流/);
  assert.match(html, /默认私有/);
  assert.match(html, /门店网络改造/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ui/react-features.test.js`

Expected: module cannot be loaded before the new feature exists.

- [ ] **Step 3: Write minimal implementation**

Create the page with an accessible list heading, privacy label, empty state and initial-item rendering. Add the navigation item between首页和AI 平台; add the new source file to the source-grouping test.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/ui/react-features.test.js test/ui/react-build.test.js`

Expected: PASS.

### Task 2: 列表筛选、创建和编辑契约

**Files:**
- Modify: `apps/web/src/features/requirements/RequirementsPage.jsx`
- Modify: `test/ui/react-features.test.js`

**Interfaces:**
- Consumes `GET /api/requirements`, `/business-units`, `/field-templates`。
- Produces client calls `POST /api/requirements` and `PATCH /api/requirements/:id`.

- [ ] **Step 1: Write the failing test**

Add a static-render assertion for the keyword input, BU/status select controls, `新建需求`, the title input, and `保存私有需求`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ui/react-features.test.js`

Expected: missing controls assertion.

- [ ] **Step 3: Write minimal implementation**

Load list metadata on mount, keep query filters in page state, submit only valid route payload properties, render configured custom field inputs by type, and refresh/open the returned requirement after writes.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/ui/react-features.test.js`

Expected: PASS.

### Task 3: 原始沟通时间线与行动区

**Files:**
- Modify: `apps/web/src/features/requirements/RequirementsPage.jsx`
- Modify: `test/ui/react-features.test.js`

**Interfaces:**
- Consumes `GET /api/requirements/:id` and `POST /api/requirements/:id/interactions`.
- Produces a local `occurredAt` value serialized to `Date#toISOString()`.

- [ ] **Step 1: Write the failing test**

Add assertions for “原始沟通记录”, the four channel options, `记录沟通`, and “下一步行动”.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ui/react-features.test.js`

Expected: missing timeline/action controls assertion.

- [ ] **Step 3: Write minimal implementation**

Open details on list selection, display interaction records without transforming their text, submit a selected channel and timestamp, then reload details. The right rail displays status-dependent suggested actions only; it must not claim that actions have been executed.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/ui/react-features.test.js`

Expected: PASS.

### Task 4: 首页、产品样式和 responsive 验收

**Files:**
- Modify: `apps/web/src/features/home/HomePage.jsx`
- Modify: `apps/web/src/styles.css`
- Modify: `test/ui/react-features.test.js`

**Interfaces:**
- `HomePage({ go })` navigates to `requirements` and `chat`.

- [ ] **Step 1: Write the failing test**

Assert that HomePage uses “今日待推进”, “快速记录沟通” and a requirements destination.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ui/react-features.test.js`

Expected: missing copy assertion.

- [ ] **Step 3: Write minimal implementation**

Replace the three marketing cards with an operator dashboard hierarchy. Add isolated CSS for the requirements page: ink-and-paper palette, dense grid, clear type scale, visual status chips, narrow-screen stacking and touch-sized controls.

- [ ] **Step 4: Run verification**

Run: `npm run build && node --test test/ui/react-features.test.js test/ui/react-build.test.js`

Expected: PASS.

### Task 5: Browser acceptance, product docs and Git delivery

**Files:**
- Modify: `README.md`
- Modify: `docs/ROADMAP.md`
- Modify: `docs/PRODUCT_GOAL.md`
- Create: `docs/dev-loop-runs/2026-09-14-p2a-requirement-workbench/03-implementation-log.md`
- Create: `docs/dev-loop-runs/2026-09-14-p2a-requirement-workbench/04-acceptance-report.md`
- Create: `docs/dev-loop-runs/2026-09-14-p2a-requirement-workbench/05-pr-summary.html`

- [ ] **Step 1: Start local demo and create isolated browser data**

Run demo only; do not use a real Provider or real team data.

- [ ] **Step 2: Browser acceptance**

Log in, create a requirement, record an IIM interaction, filter/open it, screenshot desktop and 390px widths, and record the evidence.

- [ ] **Step 3: Final verification**

Run: `npm run build`, relevant Node tests, `npm run security:scan`, and `git diff --check`.

- [ ] **Step 4: Update product documentation and commit/push**

Mark only P2A’s verified scope as complete; explicitly preserve P2B/P3 and company Provider/Linux as pending. Commit in Chinese and push `main` using GitHub credential helper.
