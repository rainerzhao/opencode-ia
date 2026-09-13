# P1A 需求与沟通底座实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为集团 BU 云解决方案工作台建立默认私有的需求与原始沟通后端闭环。

**Architecture:** 新增 `business_units`、`requirements` 和 `requirement_interactions`，以需求创建者限制所有正文读取和写入；负责人初始为创建者。SQLite 与 MySQL 使用等价仓储，Express 路由复用认证、CSRF 和审计中间件；生产组合明确注入 MySQL 仓储。

**Tech Stack:** Node.js、Express、SQLite、MySQL 8.4、node:test。

**Spec:** `docs/PRODUCT_GOAL.md`；本目录 `00-requirements.md`。

## Global Constraints

- 不绕过 OpenCode 接入模型；本阶段不调用模型。
- 生产使用外部 MySQL，Demo/SQLite 不改变该选型。
- 个人内容默认私有；管理员不读私人正文；审计不存沟通正文。
- 迁移只能追加；每阶段更新产品 README、测试、中文提交并推送。

---

### Task 1: 输入契约与迁移

**Files:** `src/requirements/requirement-input.js`、`src/db/migrations.js`、`src/db/mysql-migrations.js`、对应 `test/requirements/*input*` 与数据库迁移测试。

- [x] 写入并运行失败测试，覆盖伪造身份、非法状态、无时区日期、越界分页和未知字段。
- [x] 新增受控字段规范及 SQLite/MySQL v10–v11 追加迁移。
- [x] 验证输入测试与真库重复迁移。

### Task 2: 默认私有仓储

**Files:** `src/requirements/requirement-store.js`、`src/requirements/mysql-requirement-store.js`、对应仓储测试。

- [x] 写入失败测试：成员及管理员都不能读取另一成员的需求正文；归档 BU 不可再建需求。
- [x] 实现 BU、需求、负责人、沟通、分页与筛选；BU 归档和创建需求在事务中锁定/校验 BU。
- [x] 验证 SQLite 及真实 MySQL 持久化、越权和查询行为。

### Task 3: 认证 API 与生产组合

**Files:** `src/modules/requirements/routes.js`、`src/create-workbench-server.js`、`apps/server/index.js`、API/组合测试。

- [x] 写入失败测试：BU 写入要求管理员；接口不接受客户端所有者；沟通正文不进审计。
- [x] 添加 `/api/requirements`，复用认证/CSRF；注入 SQLite 与 MySQL 仓储。
- [x] 运行真实 MySQL HTTP 生命周期和全量回归。

### Task 4: 文档、验收与发布

**Files:** README、ROADMAP、PRODUCT_GOAL、当前目录验收产物。

- [x] 按产品表述更新当前能力和未完成边界。
- [x] 记录验证结果、审查结论和后续 P1B/P2 范围。
- [x] 中文提交：`b0943dc`；随后推送 main 并远端核验。

## Risks

- 跨人转交会改变数据访问授权，保留到明确的共享/授权模型，不通过 `responsibleUserId` 隐式开放。
- P1A 没有页面；不能以 API 完成代替 P2 浏览器验收。
