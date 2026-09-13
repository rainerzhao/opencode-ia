# P1B 实施记录

- SQLite/MySQL v12 新增 `requirement_links`，保存资源类型、资源 ID、内容版本 ID 与时间；删除关系不删除源资产。
- 需求仓储只允许关联本人激活 Conversation 或本人当前知识/方案版本；详情只返回关系卡片，管理员仍不能读取私人需求。
- `GET /api/conversations/:conversationId/events` 提供 1–1000 条受认证分页、稳定游标与 `hasMore`；实时 WebSocket 的恢复窗口保持不变。
- 新增 SQLite、MySQL、HTTP 关系及历史分页测试；全量回归通过。
