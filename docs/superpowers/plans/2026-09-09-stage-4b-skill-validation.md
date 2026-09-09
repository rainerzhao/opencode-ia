# Stage 4B Skill Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为私人 Skill 草稿增加受控多文件包、可追溯静态安全报告和经 OpenCode Gateway 的受限运行门禁。

**Architecture:** SQLite 保存版本文件与校验报告，纯函数 validator 负责不执行内容的确定性结构/安全检查，validation service 负责摘要并发保护、报告持久化和 OpenCode 运行适配。API/React 只消费稳定报告，不直接执行 Skill。

**Tech Stack:** Node.js、Express、SQLite STRICT/WAL、React/Vite、Node test runner、OpenCode 1.18.25。

**Spec:** `docs/superpowers/specs/2026-09-09-stage-4b-skill-validation-design.md`

## Global Constraints

- 所有 Skill 运行校验必须经过 OpenCode Gateway；不得由工作台直接执行上传脚本。
- 草稿默认私有，失败或未运行不得进入 `validated`。
- 报告和审计不得复制秘密命中值或 Skill 正文。
- Mac 验收不得描述为 Linux 生产就绪。
- Stage 4B 完成后更新产品 README，中文提交并推送 GitHub `main`。

---

### Task 1: migration v4 与包文件 Store

**Files:**
- Modify: `src/db/migrations.js`
- Modify: `src/skills/skill-store.js`
- Create: `test/db/skill-files-database.test.js`
- Modify: `test/skills/skill-store.test.js`

**Interfaces:**
- Produces: `skill_files` table；`replaceDraftFiles({ actor, id, files })`；详情中的 `files` 数组。

- [x] **Step 1: Write failing migration and store tests**

验证文件表约束、跨版本外键、路径唯一性、完整替换、跨账号 404、非 draft 禁止修改，以及文件修改清空报告并恢复 draft。

- [x] **Step 2: Verify RED**

Run: `node --test test/db/skill-files-database.test.js test/skills/skill-store.test.js`

Expected: FAIL，因为 migration v4 和 `replaceDraftFiles` 尚不存在。

- [x] **Step 3: Implement minimal schema and store transaction**

新增 `skill_files(id, version_id, path, content, size_bytes, content_sha256, created_at, updated_at)`；完整替换时验证数组形状并在 `BEGIN IMMEDIATE` 内删除/写入/使报告失效。

- [x] **Step 4: Verify GREEN**

Run: `node --test test/db/skill-files-database.test.js test/skills/skill-store.test.js test/db/database.test.js`

Expected: all pass。

### Task 2: 确定性结构与安全校验器

**Files:**
- Create: `src/skills/skill-validator.js`
- Create: `test/skills/skill-validator.test.js`

**Interfaces:**
- Produces: `validateSkillPackage({ slug, skillMd, files, clock }) -> report`；报告使用 spec 中 schemaVersion 1。

- [x] **Step 1: Write failing table-driven validator tests**

用手写期望覆盖有效包、缺失/重复 frontmatter 字段、name 不一致、路径逃逸、扩展名、文件数/单文件/总字节限制、疑似秘密、私钥和危险命令；断言报告不包含命中原文。

- [x] **Step 2: Verify RED**

Run: `node --test test/skills/skill-validator.test.js`

Expected: FAIL，因为 validator 模块尚不存在。

- [x] **Step 3: Implement pure validator**

实现受限 frontmatter 标量解析、包路径规范化、字节计数、SHA-256 摘要和规则结果；不得调用 `eval`、Shell、网络或 OpenCode。

- [x] **Step 4: Verify GREEN**

Run: `node --test test/skills/skill-validator.test.js`

Expected: all pass。

### Task 3: 报告持久化、API 与审计

**Files:**
- Create: `src/skills/skill-validation-service.js`
- Modify: `src/skills/skill-store.js`
- Modify: `src/modules/skills/routes.js`
- Modify: `src/create-workbench-server.js`
- Create: `test/api/skill-validation.test.js`

**Interfaces:**
- Consumes: validator、可选 `runtimeValidator.validate(input)`。
- Produces: `PUT /api/skills/:id/files`、`POST /api/skills/:id/validate`；摘要匹配时原子保存报告。

- [x] **Step 1: Write failing HTTP tests**

验证文件保存、静态失败报告、运行未配置阻止 validated、OpenCode 适配成功进入 validated、修改失效、跨账号 404、CSRF 和脱敏审计。

- [x] **Step 2: Verify RED**

Run: `node --test test/api/skill-validation.test.js`

Expected: FAIL，因为路由和 service 尚不存在。

- [x] **Step 3: Implement service and routes**

路由使用异步错误处理；service 先静态校验，通过后才调用 runtime adapter；Store 比较 digest 后保存报告并更新版本状态。

- [x] **Step 4: Verify GREEN**

Run: `node --test test/api/skill-validation.test.js test/api/skills.test.js`

Expected: all pass。

### Task 4: React 校验体验

**Files:**
- Modify: `apps/web/src/features/skills/SkillsPage.jsx`
- Modify: `apps/web/src/styles.css`
- Modify: `test/ui/react-features.test.js`

**Interfaces:**
- Consumes: files 与 validationReport。
- Produces: 附加文件编辑、校验按钮、报告摘要和逐项结果。

- [x] **Step 1: Write failing React behavior tests**

断言“附加文件”“开始校验”“未通过/已通过”、错误计数和规则列表，并保证仍明确是私人草稿。

- [x] **Step 2: Verify RED**

Run: `node --test test/ui/react-features.test.js`

Expected: FAIL，因为 4A 页面没有校验界面。

- [x] **Step 3: Implement UI**

保存文件与正文后触发校验；显示安全文案和 busy 状态；校验失败不显示发布操作。

- [x] **Step 4: Verify GREEN**

Run: `node --test test/ui/react-features.test.js && npm run build`

Expected: tests pass，build exit 0。

### Task 5: OpenCode 受限运行与 Stage 4B 验收

**Files:**
- Create: `src/skills/opencode-skill-runtime-validator.js`
- Modify: `apps/server/index.js`
- Create: `test/integration/skill-runtime-validation.test.js`
- Modify: `README.md`
- Modify: `docs/ROADMAP.md`
- Modify: `docs/dev-loop-runs/2026-09-09-stage-4b-skill-validation/*`

**Interfaces:**
- Produces: 只经 OpenCode Gateway/Runtime 的运行适配器及真实验收入口。

- [x] **Step 1: Write failing adapter and integration tests**

验证受限工作目录、禁用 Bash/联网/子代理、超时/失败关闭门禁、报告只保存安全元数据，以及真实 OpenCode 成功证据。

- [x] **Step 2: Implement and verify adapter**

复用 Stage 2 Worker/Client，不直接调用模型 API，不由 Node 执行 Skill 脚本。

- [x] **Step 3: Run final gates and browser acceptance**

Run: `npm test`、`npm run build`、`npm run check`、`npm run security:scan`、`git diff --check`；浏览器覆盖 1440×900 和 390×844。

- [x] **Step 4: Commit and push**

Commit: `完成 Stage 4B Skill 校验与受限运行门禁`；核对 `HEAD`、`origin/main` 和 `git ls-remote` 一致。
