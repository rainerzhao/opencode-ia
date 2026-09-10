# Task 1 Acceptance Report — MySQL Runtime Foundation

## Scope

本报告只覆盖 MySQL 8.4 数据库基础。它不表示 Express、认证、Gateway、Skill 或内容仓储已完成 MySQL 切换，更不表示 Linux 生产上线。

## Evidence

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| Mac 本机 MySQL 8.4 | 通过 | Docker `mysql:8.4`，仅暴露 `127.0.0.1:33067` |
| 数据库运行契约 | 通过 | 真库测试确认 8.4、`utf8mb4`、UTC、`ngram` 与 token size 2；`assertCapabilities()` 可阻断不匹配实例 |
| 迁移可重跑与互斥 | 通过 | `schema_migrations`、`GET_LOCK` 的两连接串行测试通过 |
| Schema 约束 | 通过 | 真库创建 users、Gateway、Skill、内容表；路径哈希唯一键与非 NULL 来源目标唯一键均通过回归 |
| MySQL 专属测试 | 通过 | `WORKBENCH_TEST_MYSQL_URL=… node --test test/db/mysql-database.test.js`：1 pass、0 fail |
| 既有工作台回归 | 通过 | `npm test`：282 pass、0 fail、6 环境条件 skip |
| 工程检查 | 通过 | `npm run check`、`npm run security:scan`、`npm run build` 退出码均为 0 |

## Review

内联架构、安全与可维护性审查确认：不引入同步 SQLite 兼容层；迁移 DDL 不承诺跨版本原子回滚；本地密码未进入 Git；MySQL 只保存持久业务状态，不承担 OpenCode Runtime 或 Provider 密钥。

## Remaining Work

- Task 2：用户、登录 Session、审计与 HTTP middleware 迁移为异步 MySQL Repository。
- Task 3–4：Gateway、Skill、内容仓储与 Stage 3C 来源追溯迁移。
- Task 5：删除 SQLite 运行路径、进行完整 MySQL 浏览器验收及 Linux Stage 5 验收。
