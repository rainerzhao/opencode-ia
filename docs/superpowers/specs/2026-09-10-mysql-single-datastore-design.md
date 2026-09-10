# MySQL 单一数据层设计

**状态：** 已批准实施  
**日期：** 2026-09-10  
**决策：** MySQL 8.4 是 Mac 开发、测试、Demo 与 Linux 生产的唯一业务数据库；SQLite 不再是运行 Adapter。

## 1. 为什么不是双模式

现有 Store 直接依赖 SQLite 同步 `prepare/run/get/all`、`STRICT`、FTS5、WAL 和 `BEGIN IMMEDIATE`。若保留 SQLite/MySQL 双模式，所有认证、Gateway、Skill、内容版本、迁移、全文检索和 200+ 测试将拥有两种可漂移实现。该复杂度不符合长期内网产品。

Mac 使用 Docker 的 MySQL 8.4，Linux 使用相同主版本的内部 MySQL。环境差异仅是连接地址与 Secret，不是业务数据引擎。

## 2. 运行拓扑

```text
Mac: Docker Compose                         Linux: 内网服务
Workbench Node ── mysql2/promise ── MySQL   Workbench Node ── TLS/Secret ── MySQL 8.4
       │                                            │
       └──────── OpenCode Gateway ──────────────────┘
```

OpenCode Provider 仍不通过数据库或工作台传递；MySQL 只保存工作台业务状态和脱敏审计。

## 3. Data Access Interface

引入异步 `Database` Interface：

- `query(sql, params)`：返回行与写入元数据。
- `one(sql, params)` / `many(sql, params)`：统一对象映射。
- `transaction(async tx => ...)`：使用同一个 pool connection，隔离级别 `READ COMMITTED`；失败必定 rollback。
- `close()`：优雅停止 pool。
- `health()` / `capabilities()`：验证版本、字符集、时区、FULLTEXT ngram。

Repository 是唯一接触 SQL 的 Module。路由、认证中间件和 Gateway 必须 await Repository/Service Interface；不使用同步兼容层伪装 MySQL。

## 4. Schema 与迁移

新 MySQL schema 从版本 1 建立，而非运行 SQLite 的 SQL 文本。表使用 `CHAR(36)` UUID、`VARCHAR`、`TEXT/LONGTEXT`、`JSON`、`DATETIME(3)` UTC、InnoDB 外键及显式索引。

`schema_migrations` 记录已完成版本。Runner 通过 `GET_LOCK('opencode_workbench_schema_migration', timeout)` 互斥；每条 DDL migration 独立执行、成功后单独记录。因为 MySQL DDL 隐式提交，Runner 不承诺“多条 DDL 全回滚”，只承诺可诊断、可重试、按版本幂等。

MySQL 全文检索创建 `FULLTEXT` 索引，并在 bootstrap 检查 `ngram` parser 与所需 server 配置。缺少能力时拒绝生产启动。

## 5. 迁移顺序

1. MySQL runtime、health/capability、migration runner、Docker Compose、环境变量与真实数据库 fixture。
2. 用户、Session、审计、认证与 HTTP middleware 异步化。
3. Conversation、Job、Event、Worker、Gateway service 异步化，保持状态机和恢复语义。
4. Skill、安装包、内容版本与全文检索异步化。
5. 删除 SQLite runtime、旧迁移和 SQLite-only tests；重建 Demo、浏览器验收与性能基线。
6. 在 MySQL 真源上恢复 Stage 3C、Stage 3D 与 Stage 5。

## 6. 安全和恢复

- 运行账号仅获应用 schema 所需的 DML 权限；迁移账号的 DDL 权限只在维护任务使用。
- TLS、证书校验和 MySQL Secret 在 Linux Stage 5 配置；Mac Compose 仅用于本机回环开发。
- 备份前后使用 MySQL 逻辑备份/恢复并校验版本、行数、内容哈希；具体演练在 Stage 3D/5。
- 所有错误映射为稳定业务错误；禁止将连接串、主机、密码或 SQL 正文回传浏览器。

## 7. 验收

真实 MySQL 容器上运行迁移、事务、并发锁、身份权限、Gateway 恢复、Skill/内容生命周期和 FTS 中文检索；然后运行完整 Node 测试、React 浏览器验收和 Mac 容器重启恢复。通过这些仅说明 Mac 的 MySQL 应用验收，不代表 Linux 生产上线。
