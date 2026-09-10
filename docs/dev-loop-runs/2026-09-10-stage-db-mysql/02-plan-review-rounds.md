# Plan Review Rounds

## Round 1 — inline review

当前策略未授权自行派遣子代理，因此以下为内联多视角审查。

### Architecture — APPROVED

- `IMPORTANT`：不能以同步 SQLite facade 假装 MySQL，否者连接与事务错误会隐藏。处理：全链路 async Repository Interface。
- `IMPORTANT`：MySQL DDL 隐式提交，不能沿用 SQLite 多 migration 事务语义。处理：GET_LOCK + 单 migration 记录 + 可重试诊断。

### Product / operations — APPROVED

- `IMPORTANT`：开发与生产必须用相同数据库主版本。处理：Mac Docker MySQL 8.4，Linux MySQL 8.4。
- `QUESTION`：中文全文检索。处理：要求 ngram capability，缺失阻断生产而非静默降级。

### Security / test — APPROVED

- `IMPORTANT`：不让数据库密码进入提交、日志或浏览器。处理：Secret 环境变量，测试使用临时容器凭据并清理。
- `IMPORTANT`：不能用 mock 覆盖真实事务。处理：每个垂直切片均针对真实 MySQL fixture。

无未解决 BLOCKER / IMPORTANT / QUESTION，开始 MySQL runtime foundation。
