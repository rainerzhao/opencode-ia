# Plan Review Rounds

## Execution constraint

当前任务策略禁止在未被用户明确要求时自行派遣子代理。因此本次采用内联多视角审查；审查维度与 Feature Dev Loop 的架构、产品、测试和风险视角相同。

## Round 1

### Architecture — APPROVED

- `IMPORTANT`：不得把 Event 读取、内容版本和 HTTP 权限混在 `create-workbench-server.js`。处理：以 Gateway Store、ConversationContentAdapter、Content Store、Router 和 Legacy Adapter 分离。
- `IMPORTANT`：Conversation `source_id` 不能编码范围。处理：新增受约束的细节表，保留强类型查询与索引。

### Product / privacy — APPROVED

- `IMPORTANT`：方案发布不能反向公开私人对话。处理：来源卡按读取者裁剪；仅所有者可以导航来源 Conversation，正文从不在来源卡中返回。
- `QUESTION`：默认应保存哪些消息。处理：只保存完成任务的 Assistant 输出，拒绝空结果；用户输入只保留在 Gateway 私有事件中。

### Test / compatibility — APPROVED

- `IMPORTANT`：不得直接删除旧接口而破坏历史文件和既有安全测试。处理：抽取 Legacy Adapter 并保留兼容；新增 React 契约保证正式路径停止写旧接口。

### Result

无未解决 BLOCKER / IMPORTANT / QUESTION，进入 TDD 实施。
