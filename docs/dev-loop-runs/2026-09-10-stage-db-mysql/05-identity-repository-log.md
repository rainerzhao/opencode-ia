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

## Task 2B — Express HTTP async authentication

### Scope

将认证 HTTP middleware 和管理员账号路由接入异步 MySQL Auth Service；不切换 Gateway WebSocket、Skill、知识或方案模块。

### TDD evidence

1. 先添加 `test/identity/mysql-auth-http.test.js`，覆盖真实 MySQL 登录 Cookie、`/api/auth/me` 和管理员在 CSRF 保护下创建成员。
2. 在隔离 MySQL 8.4 容器运行时得到 RED：登录后 `/api/auth/me` 读取未完成 Promise 的 `req.auth`，报错 `Cannot read properties of undefined (reading 'username')`。
3. `requireAuth` 改为等待 `authenticate()`；管理员用户列表、状态变更和撤销会话路由改为等待异步服务，随后真库用例 GREEN。

### Verified behavior

- MySQL 登录产生 HttpOnly Session Cookie 和 CSRF Cookie；
- 受保护的当前用户接口在异步鉴权完成后才读取身份；
- 管理员创建成员仍必须同时通过 Session、角色和 CSRF 校验；
- 同一 middleware 保持对既有同步 SQLite Auth Service 的兼容。

命令：`WORKBENCH_TEST_MYSQL_URL=… node --test test/identity/mysql-auth-http.test.js`，结果 1 passed、0 failed；既有 HTTP/服务回归为 11 passed、0 failed，语法检查通过。

## Task 2C — WebSocket async authentication compatibility

WebSocket upgrade、旧协议每条消息和 Gateway 协议每条消息现在都会等待 `authenticate()`，再读取 `req.auth`。新增延迟 Promise 回归用例，先确认旧实现会把 Promise 当身份对象；修复后，Gateway 在身份结果返回前不处理订阅，随后以正确用户 ID 建立订阅。

此项是为 MySQL Auth Service 预留的协议兼容，不代表 `createWorkbenchServer` 的 Gateway/Skill/内容仓储已经接入 MySQL；该应用组合仍使用历史 SQLite 业务仓储。相关 Gateway WebSocket 回归为 10 passed、0 failed，语法检查通过。
