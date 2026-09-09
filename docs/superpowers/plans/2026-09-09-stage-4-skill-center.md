# Stage 4 团队 Skill 中心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Mac 上分 4A–4D 交付普通成员可安全创建、校验、发布、安装、启用、升级和回滚的团队 Skill 中心。

**Architecture:** SQLite 是 Skill、版本和安装状态的事实源；草稿保持私有且不进入 OpenCode 发现目录。发布后的不可变版本由安装服务原子落盘，所有真实发现与执行验证都通过 OpenCode Runtime。

**Tech Stack:** Node.js、Express、SQLite STRICT/WAL、React/Vite、Node test runner、OpenCode 1.18.25。

**Spec:** `docs/superpowers/specs/2026-09-09-team-skill-center-design.md`

## Global Constraints

- 所有模型、Agent、Skill 和 Tool 执行必须经 OpenCode。
- 私人草稿默认仅创建者可见；发布必须人工确认。
- Provider 凭证不得进入前端、数据库、日志、Skill 包或 Git。
- Mac 验收不得描述为 Linux 生产就绪。
- 每个 4A–4D 阶段完成后更新产品化 README，中文提交并推送 GitHub `main`。

---

### Task 1: Stage 4A 数据模型

**Files:**
- Modify: `src/db/migrations.js`
- Create: `test/db/skill-database.test.js`

**Interfaces:**
- Consumes: `migrateDatabase(db)` and SQLite foreign-key enforcement.
- Produces: `skills`、`skill_versions`、`skill_installations` tables and indexes.

- [x] **Step 1: Write the failing migration test**

Create a real temporary database, migrate it, query `sqlite_schema`, and insert invalid status/foreign-key rows that must fail. Assert a populated version-2 database upgrades without losing users or conversations.

- [x] **Step 2: Verify RED**

Run: `node --test test/db/skill-database.test.js`

Expected: FAIL because migration version 3 and Skill tables do not exist.

- [x] **Step 3: Add migration version 3**

Use STRICT tables, foreign keys, lifecycle CHECK constraints, a case-insensitive unique slug, `(skill_id, version)` uniqueness, and one installation per `(user_id, skill_id)`.

- [x] **Step 4: Verify GREEN**

Run: `node --test test/db/skill-database.test.js test/db/database.test.js test/db/gateway-database.test.js`

Expected: all pass.

### Task 2: Stage 4A Skill store

**Files:**
- Create: `src/skills/skill-store.js`
- Create: `test/skills/skill-store.test.js`

**Interfaces:**
- Consumes: migration v3 tables and authenticated actor `{ id, role }`.
- Produces: `createSkillStore(db, { idFactory, clock })` with `createDraft`, `listVisible`, `getVisible`, `updateDraft`, `archiveDraft`.

- [x] **Step 1: Write failing store behavior tests**

Cover normalized slug, `0.1.0` initial version, owner/admin visibility, sibling 404 semantics, duplicate slug, immutable slug, draft-only updates, archive idempotency, input byte limits and transaction rollback.

- [x] **Step 2: Verify RED**

Run: `node --test test/skills/skill-store.test.js`

Expected: FAIL because `createSkillStore` does not exist.

- [x] **Step 3: Implement the store**

Use prepared statements and `BEGIN IMMEDIATE`; map rows to public summaries and private details. Never return another member's private source and never mutate a non-draft version.

- [x] **Step 4: Verify GREEN**

Run: `node --test test/skills/skill-store.test.js`

Expected: all pass.

### Task 3: Stage 4A API and audit

**Files:**
- Create: `src/modules/skills/routes.js`
- Modify: `src/create-workbench-server.js`
- Create: `test/api/skills.test.js`

**Interfaces:**
- Consumes: `createSkillStore`, global authentication/CSRF middleware, `requestAuditor.record`.
- Produces: `/api/skills` CRUD routes with `{ skill }` and `{ skills }` envelopes.

- [x] **Step 1: Write failing HTTP tests**

Exercise two members and one admin against a real temporary SQLite server. Assert create/list/detail/update/archive, missing CSRF 403, cross-account 404, invalid input 400, duplicate slug 409 and audit metadata without `skillMd`.

- [x] **Step 2: Verify RED**

Run: `node --test test/api/skills.test.js`

Expected: FAIL against the old directory-scanning endpoint.

- [x] **Step 3: Implement and mount the router**

Remove the legacy inline `/api/skills` directory scan. Map stable store error codes to HTTP status, record only lifecycle metadata, and return 204 for archive.

- [x] **Step 4: Verify GREEN**

Run: `node --test test/api/skills.test.js test/api/authorization.test.js`

Expected: all pass.

### Task 4: Stage 4A React草稿编辑器

**Files:**
- Modify: `apps/web/src/features/skills/SkillsPage.jsx`
- Modify: `apps/web/src/styles.css`
- Modify: `test/ui/react-features.test.js`

**Interfaces:**
- Consumes: `/api/skills` envelopes and shared `request()` client.
- Produces: private draft list, create/edit form, current version/status, save and archive actions.

- [x] **Step 1: Write failing React tests**

Render the page with initial drafts and assert `私人草稿`、`0.1.0`、`SKILL.md`、`保存草稿` and `归档` controls. Assert a create form contains slug, display name, description and source fields.

- [x] **Step 2: Verify RED**

Run: `node --test test/ui/react-features.test.js`

Expected: FAIL because the current page is read-only.

- [x] **Step 3: Implement the UI**

Keep API state inside `SkillsPage`, accept `initialSkills` for SSR tests, show safe errors, disable writes while saving, and refresh the selected draft from server responses.

- [x] **Step 4: Verify GREEN**

Run: `node --test test/ui/react-features.test.js && npm run build`

Expected: tests pass and Vite build exits 0.

### Task 5: Stage 4A acceptance and delivery

**Files:**
- Modify: `README.md`
- Modify: `docs/ROADMAP.md`
- Modify: `docs/dev-loop-runs/2026-09-09-stage-4-skill-center/03-implementation-log.md`
- Modify: `docs/dev-loop-runs/2026-09-09-stage-4-skill-center/04-acceptance-report.md`
- Create: `docs/dev-loop-runs/2026-09-09-stage-4-skill-center/05-pr-summary.html`

**Interfaces:**
- Consumes: final code, test output and browser evidence.
- Produces: product-facing stage status and one pushed Chinese Git commit.

- [x] **Step 1: Run the full gate**

Run `npm test`, `npm run build`, `npm run check`, `npm run security:scan`, and `git diff --check`; all must exit 0.

- [x] **Step 2: Run browser acceptance**

At 1440×900 and 390×844, create and edit a draft, switch drafts, archive one, check no horizontal overflow, and confirm console/page errors are empty.

- [x] **Step 3: Update product documentation**

Mark only Stage 4A complete. Keep 4B–4D and Stage 5 explicitly pending.

- [x] **Step 4: Commit and push**

Commit message: `完成 Stage 4A 私人 Skill 草稿与数据模型`

Verify local `HEAD`, `origin/main`, and `git ls-remote origin refs/heads/main` are identical.

### Task 6: Stage 4B–4D

Repeat the same red/green, API, browser, OpenCode acceptance, README, Chinese commit and remote-SHA gate for each later stage. 4B ends with persisted validation reports; 4C ends with published installable Skill and real OpenCode discovery; 4D ends with version upgrade, rollback, disable, archive and complete cross-account acceptance.
