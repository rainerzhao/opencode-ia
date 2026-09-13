# P1B 需求关联与完整历史实施计划

**Goal:** 在不扩大默认私有边界的前提下关联需求资产并支持完整历史分页。

**Architecture:** `requirement_links` 保存关系和不可变内容版本 ID；仓储在写入时验证同一所有者及源资产状态。Gateway 增加受认证 REST 事件分页 API，与 WebSocket 1000 条恢复窗口分离。

## Tasks

1. 追加 SQLite/MySQL 迁移和失败测试：关系唯一性、私有源验证、版本固定。
2. 增加双仓储及需求路由关联 API；所有响应仅返回元数据。
3. 在 Conversation 路由增加游标历史 API；测试超过实时回放上限仍可完整分页。
4. MySQL 真库、HTTP、全量回归、README/验收报告、中文提交推送。
