# Stage 3C 来源追溯与对话沉淀设计

**状态：** 核心链路已实现并完成 Mac 本地验证；MySQL 真库、Legacy Adapter 收敛与备份恢复仍待后续验收
**日期：** 2026-09-10  
**范围：** Conversation → 私有方案 → 私有知识草稿，以及旧方案写入路径退役

## 1. 决策

采用“**引用范围 + 校验摘要**”，不采用“复制完整 Conversation 快照”。一条来源引用由 `content_references` 承载，并由新表 `conversation_reference_details` 补充 Conversation ID、首末 Gateway 事件序号、完成轮次数和不可逆 SHA-256 摘要。

这样方案正文是成员有意保存的 Assistant 输出；私人用户输入、对话标题和完整事件流仍只保留在 Gateway 的私有 Conversation 中。来源证据可验证、可审计，但不会因为方案发布而扩散原始私聊。

## 2. 转换流程

```text
私有 Conversation（Gateway events）
  └─ 成员确认
       └─ ConversationContentAdapter
            ├─ 所有权与完成轮次校验
            ├─ 只抽取完成 Assistant `message.delta`
            ├─ 计算范围与 SHA-256 摘要
            └─ Content Store 原子创建私有 Solution v1
                  └─ 成员确认
                       └─ Content Store 原子创建私有 Knowledge v1
                            └─ 引用 Solution 当前版本
```

所有模型调用仍在 OpenCode 之前已经完成；转换过程不调用模型，也不读取 Provider 配置。

## 3. Module 与 Interface

### ConversationContentAdapter

位于 `src/content/conversation-source.js`，只接受 Gateway Store 已验证所有权的事件列表。其 Interface 返回：

- `conversationId`
- `firstSequence` / `lastSequence`
- `completedTurnCount`
- `assistantMarkdown`
- `contentSha256`

它拒绝空 Conversation、无完成 Assistant 输出、超长正文和非法事件。Gateway Store 保持 Conversation 权限与事件读取的实现；Content Store 保持版本化内容与引用事务的实现。

### Content Store

新增两个深 Interface：

- `createSolutionFromConversation(...)`：在同一 SQLite 事务中创建私有 Solution v1、通用 Conversation 引用和细节记录。
- `createKnowledgeFromSolution(...)`：在同一事务中读取当前可写 Solution 版本、创建私有 Knowledge v1 并记录 `solution_version` 引用。

调用者不传 `references`、正文版本 ID 或可见性；实现吸收这些不变量。

### Source summaries

`getSolution` 和 `getKnowledge` 返回经过可见性裁剪的来源卡。方案所有者可得到可导航 Conversation ID 与范围；其他读取者（包括管理员常规详情）只得到 `type: conversation`、轮次数、创建时间和 `private: true`。所有卡都不携带正文、标题或摘要原文。

## 4. HTTP 与前端

- `POST /api/content/solutions/from-conversation`：仅本人 Conversation，创建私有方案。
- `POST /api/content/solutions/:id/to-knowledge`：仅可编辑方案，创建私有知识草稿。
- 现有详情端点返回来源卡。
- Chat 页保留手工标题/背景输入与确认语义，但改调新端点。
- Solutions 页在私有方案编辑器显示来源卡，提供“转为知识草稿”表单和确认框；成功后跳转/提示进入知识库。

## 5. 兼容与退役

`/api/solutions` 保持只为历史文件型数据的兼容接口，不能再被 React 调用。将路由移入命名明确的 Legacy Adapter Module；本阶段不删除磁盘数据。Stage 3D 完成导入/导出与备份后，才决定迁移工具和移除时间。

## 6. 失败与隐私

- 跨账号、归档对话、无完成结果与无权方案均返回稳定 404/409/400，且不泄露资源存在。
- 事务中的任一引用写入失败必须回滚内容版本。
- 审计只保存结构化元数据；任何正文或摘要内容都不进入日志。
- 已发布方案不反向解锁私人 Conversation；管理员需要独立的、未来专门受审计流程才可例外处理。

## 7. 测试

Store 测试覆盖事务、引用、历史、摘要与权限；API 测试覆盖 CSRF、跨账号、空对话与审计脱敏；React 契约测试确认 Chat 不再使用旧端点、方案页显示安全来源并提供转换；浏览器验收覆盖桌面与 390px 宽度。
