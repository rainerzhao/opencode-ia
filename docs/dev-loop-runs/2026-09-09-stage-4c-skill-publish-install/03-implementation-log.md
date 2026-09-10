# Implementation Log

## Task 1 — 发布与安装状态契约

- 新增发布、团队安装候选、安装记录、安装状态与 enabled 查询的 SQLite Store 生命周期。
- 发布会在事务内重新核验所有权、当前内容摘要、静态 verdict 和 OpenCode Runtime 状态；发布后版本不可编辑。
- 安装状态按账号派生，重复安装同一不可变版本幂等。
- 红—绿证据：`node --test test/skills/skill-publish-install-store.test.js test/skills/skill-store.test.js`，13/13 通过。

## Task 2 — 原子安装与工作区物化

- 新增 `SKILL_INSTALL_ROOT`，默认位于运行数据目录，不会成为全局自动发现目录。
- 安装包以每账号、每 slug 的受管目录保存；目录 0700、文件 0600、manifest 和内容摘要在落盘后复核。
- 拒绝符号链接、硬链接、路径逃逸、特殊文件与摘要漂移；写库失败会删除本次新建包。
- Conversation 在执行前把 enabled 包复制到 `.opencode/skills` 的临时集合并原子替换；失败保留旧集合且不执行 Prompt。
- 红—绿证据：文件、补偿、摘要漂移和隔离测试 20/20 通过。

## Task 3 — Gateway、API 与审计

- Gateway 增加工作区准备钩子，位于创建或复用 OpenCode Session 之前。
- 新增发布、安装、启用、安装列表 API；所有写入沿用登录、CSRF 和脱敏审计。
- 启用会再次调用共享 OpenCode Gateway；失败保持 `installed`，成功才写入 `enabled`。
- API/Gateway 回归：37/37 通过。

## Task 4 — 产品界面与 Demo

- Skill 页拆分“私人草稿”和“团队已发布”；校验通过才显示“发布到团队”，且发布有明确确认。
- 团队目录展示当前账号的“安装 / 已安装 / 启用 / 已启用”状态；不会自动替其他账号操作。
- 无密钥 Demo 现覆盖创建、校验、发布、创建第二账号、安装与启用全链路。
- UI/Demo/构建：14/14 通过，Vite 40 modules 构建通过。

## Task 5 — 真实 OpenCode 与浏览器验收

- 新增 `npm run test:skill-install-discovery`：真实 OpenCode 1.18.25 验证 member-a 的已启用包可发现、member-b 不可发现；本轮证据为 `skill-tool-completed`。
- 同时复跑现有 `npm run test:skill-validation`，确认私人校验包仍可真实发现与加载。
- Browser：Demo 中完成创建、校验、发布、安装、启用；1440×900 和 390×844 截图无页面横向溢出、无 Console/Page Error。

## Scope Note

本记录只证明 Mac 上的应用级交付。版本升级、回滚、停用、归档、Linux 服务化、OS 级隔离、备份、监控和长期容量仍未交付。
