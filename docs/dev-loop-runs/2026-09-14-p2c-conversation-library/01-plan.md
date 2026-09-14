# P2C 会话资料库 Implementation Plan

**Goal:** 交付默认私有的 Conversation 搜索、分页、归档和恢复闭环。

**Architecture:** Store 统一接收 `{ ownerUserId, status, q, limit, offset }`，仅在 owner 条件中检索标题。路由解析受限查询参数并暴露 restore 动作；前端资料库只消费元数据列表，继续用 Gateway/WebSocket 承载运行时上下文。

## Task Order

1. 写 SQLite/MySQL Store 与 REST 的失败测试：查询必须 owner-only，恢复只允许 archived 状态，非法查询/跨账号失败。
2. 以最小 SQL/Repository 改动实现查询、计数和恢复；为列表返回 `hasMore`，不返回消息正文。
3. 扩展 ConversationList/ChatPage：搜索、状态筛选、分页、当前项归档、已归档项恢复。
4. 隔离 Demo 浏览器验证桌面与 390px；更新 README、目标、验收材料，运行全量门禁并提交。

## Risks

- 恢复后 OpenCode Session 是否能在重启后继续由既有 Gateway recovery 决定；本阶段只恢复业务 Conversation，不自动重放中断任务。
- MySQL 真库生命周期需要单独 opt-in；代码与 SQLite HTTP 先作为本机验收，不能宣称云库生产已验收。
