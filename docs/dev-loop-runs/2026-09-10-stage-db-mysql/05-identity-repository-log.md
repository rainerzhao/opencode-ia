# Task 2A — MySQL Identity Repository Log

## Scope

在真实 MySQL 上实现用户、登录 Session 与审计 Repository；本步骤不改变现有 SQLite HTTP 运行链路。

## TDD evidence

1. 先添加 `test/identity/mysql-identity-stores.test.js`，确认模块缺失而 RED。
2. 实现三个异步 Repository 后，真库 RED 暴露 MySQL `DATETIME(3)` 不接受 ISO `T/Z` 格式。
3. 统一在 Repository 边界将 ISO UTC 写为 MySQL UTC DATETIME，并将读出的 DATETIME 还原为毫秒精度 ISO UTC；重复运行后 GREEN。

## Verified behavior

- 用户名标准化、唯一冲突、公开/认证字段分离；
- 仅保存 token/CSRF 哈希，撤销操作幂等；
- 审计 JSON 及 actor/source metadata；
- 同一 MySQL connection 的事务回滚不留下用户记录。

命令：`WORKBENCH_TEST_MYSQL_URL=… node --test test/identity/mysql-identity-stores.test.js`，结果 1 passed、0 failed。

## MySQL Auth Service

- 首位管理员初始化支持显式 MySQL Repository Factory，并在同一 MySQL transaction 内完成用户和审计写入。
- 新增异步 MySQL Auth Service，覆盖登录、会话校验、登出、改密、成员治理与审计；不把 Promise 伪装成同步值。
- 真库验收覆盖初始化、登录、改密、会话失效和审计。HTTP/WebSocket 调用点仍待下一子步骤切换，不能将该实现描述为已接管工作台认证。
