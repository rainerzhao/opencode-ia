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
