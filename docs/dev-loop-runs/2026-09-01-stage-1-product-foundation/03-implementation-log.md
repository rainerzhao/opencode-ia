# Stage 1 Implementation Log

## Baseline

- Base SHA: `9014062af8de0a3fae70353d723a82b37c3ba82e`
- Branch: `main`
- Mode: inline serial execution; one verified commit and push per stage

## Stage 1A

Status: implemented and verified.

### Delivered

- Node 24 内置 SQLite 文件数据库，启用外键、WAL 和 5 秒忙等待。
- 版本化、事务化迁移；失败整批回滚；旧应用拒绝打开更新版本数据库。
- `users`、`login_sessions`、`audit_logs` 初始结构与索引。
- `scrypt` 密码哈希、独立随机盐、恒定时间比较和 12–128 字符策略。
- 用户、Session 和审计仓储；数据库只保存 Session 与 CSRF 的 SHA-256 哈希字段。
- 首位管理员原子初始化与安全审计事件。
- `npm run admin:create -- --username <name> --display-name <name>` 交互式 CLI；拒绝密码参数。

### TDD Evidence

- Database RED: missing `src/db/open-database`; GREEN: WAL/migration/persistence tests passed.
- Password RED: missing `src/auth/password`; GREEN: random-salt/malformed-hash/policy tests passed.
- Bootstrap RED: missing user store; GREEN: one-admin invariant and audit tests passed.
- Session RED: missing session store; GREEN: hash-only storage and revocation tests passed.
- Config RED: `databasePath` undefined; GREEN: default and override tests passed.
- CLI RED: missing `scripts/create-admin.js`; GREEN: real child-process tests passed.
- Schema compatibility RED: newer schema was accepted; GREEN: `DATABASE_SCHEMA_TOO_NEW` stops startup.
- Review RED: database inherited group/other read bits; GREEN: every file database is forced to mode `0600`.
- Review RED: display names accepted embedded control characters; GREEN: control characters are rejected before hashing or writes.

### Verification

- `npm test`: 79/79 passed.
- `npm run check`: 34 JavaScript files passed syntax validation.
- `npm run security:scan`: no findings.
- `git diff --check`: passed.

### Inline Code Review

- Initial verdict: `REQUEST_CHANGES` for database file permissions and display-name control characters.
- Fix verification: targeted database/bootstrap suite 6/6 passed.
- Final verdict: `APPROVE`; no unresolved blocking or important findings.

## Stage 1B

Status: implemented and verified.

### Delivered

- 32-byte高熵不透明 Session 与 CSRF 凭据，SQLite 只保存 SHA-256 摘要。
- `HttpOnly` Session Cookie、前端可读 CSRF Cookie、`SameSite=Lax`、统一路径与可配置 `Secure`。
- 登录、退出、当前用户和修改密码 API；修改密码后撤销该用户全部 Session。
- 管理员建号、列表、重置密码、启停账号和强制撤销 Session API。
- `admin/member` 管理边界；普通成员不能调用账号管理接口。
- 用户名与来源 IP 双维度、有界内存登录限速；成功登录不清空来源 IP 的失败累计。
- 认证和管理员响应统一 `Cache-Control: no-store`，防止身份信息被中间缓存复用。
- 登录、退出、改密、建号、重置、启停和 Session 撤销写入结构化审计事件。

### TDD Evidence

- HTTP RED：认证与账号管理端点返回 `404`；GREEN：真实 HTTP/Cookie/SQLite 用例通过。
- Config RED：认证安全配置未定义；GREEN：默认值、显式覆盖和严格布尔解析通过。
- Review RED：成功登录可清空来源 IP 失败累计；GREEN：只清除用户名维度，保留 IP 防爆破状态。
- Review RED：`/api/auth/me` 和管理员列表可被缓存；GREEN：认证路由组统一返回 `Cache-Control: no-store`。

### Verification

- Targeted authentication suites: 14/14 passed after review fixes.
- `npm test`: 100/100 passed.
- `npm run check`: 47 JavaScript files passed syntax validation.
- `npm run security:scan`: zero findings.
- `git diff --check`: passed.
- Browser report: desktop 1440px and mobile 390px, zero overflow and zero page/console errors; screenshots saved under `artifacts/screenshots/`.

### Inline Code Review

- Initial verdict: `REQUEST_CHANGES` for source-IP limiter reset and cacheable identity responses.
- Fix verification: targeted Service and real HTTP suites passed.
- Final verdict: `APPROVE`; no unresolved `BLOCKER`, `IMPORTANT` or `QUESTION` findings.
- Residual boundary: existing business REST and WebSocket remain anonymous until the independent Stage 1C cutover.
- Git delivery: the verified local commit is prepared; remote push verification is pending refreshed GitHub authentication.
