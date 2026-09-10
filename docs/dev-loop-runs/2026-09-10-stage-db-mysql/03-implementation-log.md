# Implementation Log

## 2026-09-10

- 用户确认 MySQL 单一数据层。
- Docker Desktop 已启动；拉取并运行 `mysql:8.4`，仅绑定 `127.0.0.1:33067`，密码只经未提交环境变量提供。
- 增加 `mysql2/promise` Database Interface、MySQL 迁移 Runner、v1–v5 schema 与 Compose/Secret 模板。
- 真实迁移先后暴露并修正两项 MySQL 8.4 差异：`utf8mb4` 下 1024 字符路径的唯一索引超长，改为 `workspace_path_sha256` 唯一键；生成列与外键组合不可建表，改为受 CHECK 约束的显式 current-target 列。
- 针对 `content_references` 写出 RED 测试，确认 MySQL 联合唯一键允许多个 NULL；改为显式 target type/id、CHECK 和非 NULL 唯一键后 GREEN。
- `assertCapabilities()` 现将 MySQL 8.4、`utf8mb4`、UTC、`ngram` 与 token size 2 作为可阻断的运行契约，而非只返回诊断字段。
- 新增产品架构说明，明确 MySQL 是持久业务状态，OpenCode Worker Pool 是唯一 Agent Runtime；Conversation、Session、Worker 和执行槽位必须分离。
- 真库验收命令：`WORKBENCH_TEST_MYSQL_URL=… node --test test/db/mysql-database.test.js`，结果 1 passed、0 failed；覆盖 8.4、utf8mb4、UTC、ngram、迁移重跑、GET_LOCK 串行、核心表及来源去重。
- Task 1 只完成数据库基础，应用仍调用 SQLite；Task 2 才开始身份/审计异步仓储切换。
