# Stage 4C Skill Publish, Install and Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让已校验私人 Skill 经人工发布成为团队资产，并支持每个成员独立安装、启用和在自己的 OpenCode Conversation 中发现。

**Architecture:** SQLite 保存发布与账号安装事实，受管文件服务把不可变包原子写入每用户目录，工作区同步器在 Conversation 执行前原子物化 enabled Skill。启用先从安装目录读取并经共享 OpenCode Gateway 验证，成功后才更新状态。

**Tech Stack:** Node.js、Express、SQLite STRICT/WAL、React/Vite、Node test runner、OpenCode 1.18.25。

**Spec:** `docs/superpowers/specs/2026-09-09-stage-4c-skill-publish-install-design.md`

## Global Constraints

- 所有 Skill 发现和执行只经过 OpenCode；工作台不直连模型 API。
- 发布、安装、启用是三个独立的人类动作；默认私有不变。
- 目录 0700、文件 0600；不使用软链接、硬链接或请求提供的宿主路径。
- 4C 不实现新版本、升级、回滚、停用或撤回。
- Mac 验收不得描述为 Linux 生产就绪。
- 完成后更新产品 README，使用中文提交并尝试推送 `main`。

---

### Task 1: 发布与安装状态 Store

**Files:**
- Modify: `src/skills/skill-store.js`
- Create: `test/skills/skill-publish-install-store.test.js`

**Interfaces:**
- Produces: `publishValidated({ actor, id })`、`getPublishedInstallCandidate({ actor, id })`、`recordInstallation({ actor, skillId, versionId })`、`setInstallationStatus({ actor, skillId, status })`、`listInstallations({ actor })`、`listEnabledInstallations({ userId })`。

- [ ] **Step 1: Write failing Store tests**

用真实内存 SQLite 创建 owner、sibling、validated/pass 包，断言 owner/admin 可发布，sibling 发布返回 `SKILL_NOT_FOUND`，draft/过期报告返回 `SKILL_NOT_PUBLISHABLE`，发布后 team 可见且正文不可编辑。断言成员只能为自己写 installation，重复安装幂等，未发布版本不可安装，状态只允许 installed/enabled/disabled。

- [ ] **Step 2: Verify RED**

Run: `node --test test/skills/skill-publish-install-store.test.js`
Expected: FAIL，因为发布与安装 Store 方法不存在。

- [ ] **Step 3: Implement minimal transactional lifecycle**

`publishValidated` 在 `BEGIN IMMEDIATE` 中重新读取当前行和报告，比较 `report.contentSha256 === row.content_sha256`、`verdict === 'pass'`、`runtime.status === 'passed'`，然后同时更新 Skill 与版本。安装查询只返回 team/published 当前版本；installation 所有方法从 actor.id 派生 user_id。

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/skills/skill-publish-install-store.test.js test/skills/skill-store.test.js`
Expected: all pass。

### Task 2: 原子用户安装与 Conversation 物化

**Files:**
- Modify: `src/config.js`
- Create: `src/skills/skill-installation-files.js`
- Create: `src/skills/skill-installation-service.js`
- Create: `src/skills/skill-workspace-sync.js`
- Create: `test/skills/skill-installation-files.test.js`
- Modify: `test/config.test.js`

**Interfaces:**
- Consumes: Task 1 Store 方法、Stage 4B `normalizeSkillFiles` 与 `skillPackageDigest`、`runtimeValidator.validate(input)`。
- Produces: `install({ actor, id })`、`enable({ actor, id })`、`syncEnabledSkills({ userId, directory })`；配置 `skillInstallRoot`。

- [ ] **Step 1: Write failing filesystem and service tests**

在临时目录断言安装包包含 `SKILL.md`、附加文件和安全 manifest；权限为 0700/0600；路径由 actor/slug 派生；临时写入失败不留目录；Store 失败清理新目录；启用读取磁盘包调用 Runtime，失败保持 installed；同步只物化该 user 的 enabled 包并原子替换旧集合。

- [ ] **Step 2: Verify RED**

Run: `node --test test/skills/skill-installation-files.test.js test/config.test.js`
Expected: FAIL，因为文件服务、同步器和 `skillInstallRoot` 不存在。

- [ ] **Step 3: Implement atomic file boundaries**

在同一父目录使用 `fs.mkdtempSync`，写入后调用 `secureWorkspaceTree` 并逐文件复算摘要；用 rename 提交。物化时构建 `.opencode/skills-next-*`，从 manifest 验证 skillId/versionId/slug/digest，复制普通文件，最后替换 `.opencode/skills`；任何异常删除临时目录并保持原目录不变。

- [ ] **Step 4: Implement install and enable orchestration**

`install` 从 Store 取得发布候选并先落盘后记录数据库，失败补偿。`enable` 从已安装目录读取包，用当前 actor 和版本调用 Runtime；只有 status passed 才写 enabled，否则抛 `SKILL_ENABLE_VALIDATION_FAILED` 并保持 installed。

- [ ] **Step 5: Verify GREEN**

Run: `node --test test/skills/skill-installation-files.test.js test/config.test.js`
Expected: all pass。

### Task 3: Gateway 工作区接入、API 与审计

**Files:**
- Modify: `src/gateway/gateway-service.js`
- Modify: `src/create-workbench-server.js`
- Modify: `apps/server/index.js`
- Modify: `src/modules/skills/routes.js`
- Create: `test/api/skill-publish-install.test.js`
- Modify: `test/gateway/gateway-service.test.js`
- Modify: `test/fixtures/authenticated-workbench.js`

**Interfaces:**
- Consumes: `syncEnabledSkills({ userId, directory })` 与安装 service。
- Produces: publish/install/enable/installations HTTP API；Gateway 在任何 OpenCode session/prompt 前完成工作区 Skill 同步。

- [ ] **Step 1: Write failing API and Gateway tests**

通过真实 HTTP/CSRF 断言 owner 发布、sibling 404、团队目录、当前账号安装列表、成员安装/启用与脱敏审计。Gateway 测试断言 workspace sync 在 createSession 前调用，失败时任务 failed 且 prompt 未执行，两个账号不会收到彼此 enabled Skill。

- [ ] **Step 2: Verify RED**

Run: `node --test test/api/skill-publish-install.test.js test/gateway/gateway-service.test.js`
Expected: FAIL，因为路由与 workspace sync 尚未接线。

- [ ] **Step 3: Wire services and safe routes**

`createWorkbenchServer` 在 migration 后创建共享 Skill Store、文件服务、安装 service 和 workspace sync，并把 preparer 交给 Gateway factory。路由顺序先注册 `/installations` 再注册 `/:skillId`；所有写操作沿用 CSRF，审计 metadata 只含 version/status/digest。

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/api/skill-publish-install.test.js test/api/skills.test.js test/api/skill-validation.test.js test/gateway/gateway-service.test.js`
Expected: all pass。

### Task 4: React 团队目录与无密钥 Demo

**Files:**
- Modify: `apps/web/src/features/skills/SkillsPage.jsx`
- Modify: `apps/web/src/styles.css`
- Modify: `scripts/start-demo.js`
- Modify: `test/ui/react-features.test.js`
- Modify: `test/demo/start-demo.test.js`

**Interfaces:**
- Consumes: Task 3 HTTP API。
- Produces: 我的草稿/团队已发布视图、人工发布确认、安装和启用状态；Demo 完整闭环。

- [ ] **Step 1: Write failing React and Demo tests**

断言 validated 私人版本显示“发布到团队”且点击前需要确认；普通成员团队目录显示“安装”“启用”“已启用”；draft 不显示发布。Demo 全栈测试创建、校验、发布，再用第二账号安装启用并读取状态。

- [ ] **Step 2: Verify RED**

Run: `node --test test/ui/react-features.test.js test/demo/start-demo.test.js`
Expected: FAIL，因为 4C 控件和 Demo 生命周期不存在。

- [ ] **Step 3: Implement minimal product flow**

页面加载私人 drafts、published catalog 和当前 installations；发布使用 `window.confirm` 明确说明发布后不可修改；安装和启用分别调用 API 并刷新。所有文案继续强调发布是团队可见、启用只影响当前账号。

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/ui/react-features.test.js test/demo/start-demo.test.js && npm run build`
Expected: all pass，Vite build exit 0。

### Task 5: 真实发现与 Stage 4C 交付

**Files:**
- Create: `test/integration/skill-install-discovery.test.js`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/ROADMAP.md`
- Modify: `docs/dev-loop-runs/2026-09-09-stage-4c-skill-publish-install/*`

**Interfaces:**
- Produces: `npm run test:skill-install-discovery` 与 Stage 4C 最终证据。

- [ ] **Step 1: Write and run real OpenCode acceptance**

创建两个测试账号；owner 发布同一安全包，member-a 安装并启用，member-b 不安装；同步两个 Conversation 工作区。真实 OpenCode `/skill` 必须只在 member-a 目录返回目标 slug，并且 member-a 的完成态 `skill` tool evidence 与目标名匹配。

- [ ] **Step 2: Run final gates**

Run: `npm test`、`npm run test:skill-validation`、`npm run test:skill-install-discovery`、`npm run build`、`npm run check`、`npm run security:scan`、`git diff --check`。浏览器覆盖 1440×900 和 390×844 的发布、安装、启用流程。

- [ ] **Step 3: Update product delivery material**

README 与 ROADMAP 标记 4A–4C 完成、4D 开发中；验收报告明确 Mac/OpenCode 版本、真实发现证据、Linux 未完成；生成自包含 HTML 摘要和截图。

- [ ] **Step 4: Commit and push**

Commit: `完成 Stage 4C Skill 发布安装与 OpenCode 发现`。先确认 4A、4B、4C 本地提交连续，再执行 `git push origin main`；网络失败时保留提交并记录远端仍停留的 SHA，不重写历史。
