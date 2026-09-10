# Requirements Baseline

## Goal

建立 Stage 3A 内容底座：用 SQLite 保存知识与方案的资产、不可变版本、归属、可见性和 FTS5 索引，为后续人工发布、撤回、来源追溯和恢复提供稳定真源。

## Non-goals

- 本阶段不把私人内容自动发布为团队资产。
- 本阶段不调用模型、不绕过 OpenCode，也不向数据库、审计或前端写入 Provider 凭证。
- 本阶段不实现 PDF/DOCX 文本抽取、导入导出、备份恢复、版本差异 UI 或团队发布审批；它们分别属于 Stage 3B–3D。
- 已存在的文件型知识与方案 HTTP 接口暂不迁移，避免破坏当前 Demo；后续阶段以兼容迁移方式切换。

## User-visible Behavior

- 产品当前已存在的“私有知识”和“私有方案”体验保持可用。
- 后续 API 能以稳定 ID 读取内容资产的当前版本，并在不泄露私有内容的前提下，检索调用者拥有的草稿与团队发布内容。

## Acceptance Criteria

1. 迁移可从 Stage 0–4 的既有数据库升级，且不改变现有表数据。
2. `knowledge_documents`、`knowledge_versions`、`solutions`、`solution_versions` 具有外键、状态、可见性和版本唯一性约束。
3. FTS5 可检索知识标题、分类、标签和 Markdown 正文；私有结果只能由所有者或管理员查询，团队结果对所有已登录成员可见。
4. 写入版本时，旧版本不可变；每个资产只能有一个当前版本，并能取得不含正文的安全摘要。
5. 方案元数据可保留对 Conversation、模型、知识版本和 Skill 版本的引用 ID，但不会保存密钥、Cookie 或系统提示。
6. 仓储层的所有新增行为先有失败测试，再以最小实现转绿；回归、构建、语法、密钥和 diff 检查通过。

## Constraints

- SQLite 是单机元数据真源，Markdown 仍为知识正文标准格式。
- 默认 `private`；只有后续明确发布动作才能改为 `team`。
- 管理员可治理资产元数据，但不将私人正文作为常规列表或审计数据返回。
- 所有时间使用 ISO 8601 UTC 字符串；ID 使用调用方可注入的 UUID 工厂，便于可重复测试。
- 新增代码沿用 CommonJS 与 Node 内置 `node:sqlite`，不增加依赖。

## Assumptions

- Stage 3A 建立的 Store 是后续模块路由的唯一写入入口；旧接口在迁移期是兼容读写层。
- FTS 只索引当前版本；版本历史由规范化表保存，不在索引中重复暴露。
- 共享可见性沿用当前权限语义的 `team` 表示，后续路由映射为 `shared` 资源权限检查。

## Open Questions

无阻塞问题。根据已批准的路线图，先完成可测试数据底座，再连续推进发布和 UI 阶段。

## Source Request

用户要求继续把项目完成为完整的团队 AI 工作台，并在每个可验收阶段完成后提交、推送 Git；产品约束是默认私有、账号密码、所有 Agent/Skill/Tool 经 OpenCode、Mac 验收不得表述为 Linux 生产就绪。

## Repo Context

基线提交为 `b6ef5d8`。当前已有 SQLite 迁移 1–4（账号、Gateway、Skill）以及文件型私有知识/方案接口；路线图将 Stage 3 定义为 FTS5、版本、私有到发布流程和可追溯性。
