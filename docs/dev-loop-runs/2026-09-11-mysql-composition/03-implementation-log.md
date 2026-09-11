# MySQL-only 服务组合 Implementation Log

## 2026-09-11

- `createWorkbenchServer` 新增 Repository 注入边界，允许异步 MySQL Store 复用同一 HTTP/WebSocket 应用装配，不改变历史 SQLite Demo。
- 新增 `createMySqlProductionWorkbench`：MySQL 能力检查、迁移、认证/审计/Gateway/内容/Skill Repository 注入，以及统一 Gateway 生命周期关闭。
- `startProduction` 在存在 `WORKBENCH_DATABASE_URL` 时选择 MySQL 组合；缺失时继续使用 SQLite 组合。
- 配置与 `.env.example` 增加 MySQL URL 和连接池边界，README 明确凭证不进仓库且当前仍非 Linux 生产结论。
- 本阶段重点完成代码级组合与配置契约；真实 MySQL 端到端和 Linux 验收待下一阶段。
