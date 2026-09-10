# Requirements Baseline

## Goal

将 OpenCode 团队 AI 工作台从 SQLite 单一实现迁移为 MySQL 单一数据层：Mac 开发/验收和公司内网 Linux 生产均使用 MySQL 8.4；不保留 SQLite 运行或 Demo Adapter。

## Non-goals

- 本阶段不部署 Linux、不接入内部模型 Provider、不改变 OpenCode Gateway 产品协议、不完成 Stage 3C/3D。
- 不在代码、数据库、日志、Docker Compose 或 Git 中写入真实 MySQL 密码、Provider Key 或用户数据。
- 不把 SQLite 文件自动作为生产数据；如需迁移实际历史数据，提供显式、受确认的离线导入工具和备份点。

## Acceptance Criteria

1. Mac 本地可用 Docker Compose 启动 MySQL 8.4；服务、Demo、测试和开发都通过环境变量连接 MySQL，缺少配置时快速失败。
2. 移除 Node `node:sqlite` 和 `DatabaseSync` 的业务依赖；用户、Session、审计、Conversation、Gateway Job/Event、Skill、内容版本均由 MySQL 表保存。
3. 数据访问变为异步 Repository Interface；所有事务使用 MySQL 单连接 `BEGIN/COMMIT/ROLLBACK`，不依赖 SQLite 的同步 `prepare/run/get/all` 语义。
4. MySQL schema migration 具备应用版本记录、并发迁移锁、失败诊断和可重复运行语义；DDL 自动提交限制被显式处理。
5. 现有隐私、权限、CSRF、审计、Gateway 恢复、Skill 生命周期与内容版本测试迁移至真实临时 MySQL 数据库；不以 mock 替代数据库行为。
6. 知识检索使用 MySQL InnoDB FULLTEXT + `ngram`，启动前检验能力；若内网实例不满足该前提，阻断生产启动并给出安全诊断，而非退回 SQLite 或静默降级。
7. README、路线图、`.env.example`、Demo 说明和部署契约明确标注 MySQL 已取代 SQLite，但不宣称 Linux 已上线。
8. Docker/本机真实 MySQL 验收、完整回归、构建、语法、密钥扫描、差异检查通过后，中文提交并推送 `main`。

## Constraints

- MySQL 版本固定为 8.4 LTS；字符集 `utf8mb4`、排序规则 `utf8mb4_0900_ai_ci`，连接时区 UTC。
- 密码仅从运行环境 Secret 注入；本地 `.env` 和 Compose override 均被 Git 忽略。
- 正式 MySQL 账号遵循最小权限：应用账号不拥有 `SUPER`、`FILE` 或全局管理权限；迁移账号与运行账号可以分离。
- MySQL 是唯一业务事实源；附件和 Skill 包继续放在受管文件目录，元数据与引用在 MySQL。

## Assumptions

- 当前仓库没有需要保留的生产 SQLite 数据；现有数据仅为 Mac 开发、Demo 或自动测试数据。
- 公司内网 Linux 将提供或允许建立 MySQL 8.4 实例；生产访问凭据、主机名、证书与备份策略将在 Stage 5 由管理员注入。
- Docker Desktop 可在本机启动，用作 Mac 的真实 MySQL 验收环境。

## Source Request

用户于 2026-09-10 确认选项 1：MySQL 单一数据层。

## Repo Context

- 基线为 `0484af6`；现有 303 处数据库调用使用 Node `node:sqlite` 的同步 `prepare/exec` Interface。
- Docker Desktop 与 Compose 已启动；真实 `mysql:8.4` 容器已用于 Task 1 验收。
- Stage 3C 来源追溯设计已暂停，待本阶段关闭后以 MySQL Repository 重新实施。
