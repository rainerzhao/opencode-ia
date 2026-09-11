# Requirements Baseline

> **状态：** 核心链路已实现并完成 Mac 本地验证；全量 MySQL 真库回归、旧文件接口适配层整理和浏览器验收仍待完成。

## Goal

完成 Stage 3C：成员能从自己的 OpenCode Conversation 人工沉淀一份默认私有的版本化方案，并从方案创建默认私有的知识草稿；每次转换都保留可验证、可展示但不泄露私人正文的来源链。聊天页不再写遗留 `/api/solutions` JSON。

## Non-goals

- 不调用模型自动生成方案，不自动发布团队内容，也不改变 OpenCode Runtime、Provider、Skill 或 Tool 调用链。
- 不实现附件解析、导入导出、备份恢复、版本差异或永久删除；这些属于 Stage 3D。
- 不迁移或删除磁盘上的历史 Markdown/JSON；仅停止正式 React 路径对旧 `/api/solutions` 的写入。

## User-visible Behavior

1. 成员在自己的 Conversation 中点击“沉淀为方案”，输入标题和补充背景后确认；系统保存该 Conversation 已完成轮次的 Assistant 输出为方案正文，默认私有。
2. 方案详情显示来源卡：Conversation 标识、选定事件序号范围、完成轮次数、创建时间和校验摘要；只有来源所有者可打开对应 Conversation。
3. 成员在自己可编辑的方案中点击“转为知识草稿”，输入标题、分类和标签后确认；知识草稿默认私有，正文来自该方案当前不可变版本。
4. 团队成员可阅读已发布方案/知识，但绝不获得私人 Conversation 标题、用户输入、完整对话、Cookie、Provider 凭证或系统提示。

## Acceptance Criteria

1. 新的受认证、CSRF 保护 API 只能转换调用者拥有的 Conversation / 可编辑的方案；跨账号与不存在资源均以 404 失败。
2. Conversation 转换仅允许至少包含一条已完成 Assistant 输出的对话；失败、取消、排队、运行中任务不进入方案正文。
3. `content_references` 记录 Conversation、起止事件序号、完成轮数和 SHA-256 摘要；摘要在创建时计算，不复制私人正文。
4. 方案转知识在 SQLite Store 的一个事务中创建知识版本和指向方案当前版本的引用；不允许客户端伪造来源 ID。
5. 方案/知识详情提供安全来源摘要。团队读者仅获得不可导航的“创建者私人 Conversation”元数据；管理员的常规读取亦不暴露私人 Conversation 正文。
6. Chat React 页面改用 `/api/content/solutions/from-conversation`，并以页面内确认操作替换遗留 `/api/solutions` 写入；方案页提供“转为知识草稿”的页面内确认操作。
7. 旧 `/api/solutions` 标记为兼容接口：React 不再使用，README、路线图和迁移说明明确其不属于版本化内容真源。
8. Store、API、React 契约、完整回归、构建、语法、密钥扫描和桌面/移动浏览器验收通过；以中文提交并推送 `main`。不得称为 Linux 生产上线。

## Constraints

- 工作台不直连模型 API；本阶段仅读取已有 Gateway 事件，所有 Agent / Model / Skill / Tool 仍经 OpenCode。
- 默认私有。发布和撤回保持 Stage 3B 已有人工确认规则。
- 审计仅记录动作、资源 ID、来源版本/事件范围、消息计数和请求 ID；不可记录用户输入、Assistant 正文、标题、摘要原文、密钥或 Cookie。
- 使用已有 CommonJS、Express、SQLite、React/Vite 与 Node Test Runner；不新增依赖。

## Assumptions

- “一次对话沉淀”默认包含该 Conversation 中每个完成任务的最后一条 `message.delta`；`message.created` 的用户输入永不复制到方案正文。
- Conversation 事件已按序列持久化且 `message.delta` 是完成的 Assistant 文本，能作为来源范围的稳定证据。
- Conversation 来源对方案所有者可导航；其他读者只能见到脱敏的来源卡。

## Open Questions

- 无阻塞问题。附件的来源文件标识、内容抽取与备份保留策略在 Stage 3D 单独确定。

## Source Request

活跃 Goal：先完成知识/方案来源追溯、附件与备份恢复并收敛遗留内容接口，随后推进 Linux 内网生产化。

## Repo Context

- Base: `0484af6` on `main`, working tree clean.
- Stage 3A–3B 已提供 SQLite 版本化内容、FTS5、私有草稿与发布/撤回。
- `apps/web/src/features/chat/ChatPage.jsx` 仍写遗留 `/api/solutions`；`src/create-workbench-server.js` 仍承载文件型知识/方案兼容路由。
