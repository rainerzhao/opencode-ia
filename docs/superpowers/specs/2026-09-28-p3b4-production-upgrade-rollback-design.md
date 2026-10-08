# P3B4 生产升级与回滚验收设计

确认日期：2026-09-28

## 目标与产品边界

为 OpenCode 团队 AI 工作台增加一个公司 Linux 专用的升级/回滚验收入口，证明同一份验收数据能够经历“上一稳定版本 → 候选版本 → 上一稳定版本恢复环境”的完整路径。验收必须覆盖账号登录、三个持久 Conversation 的多轮 OpenCode 上下文、唯一任务终态和附件字节一致，并留下不含秘密的版本与恢复结论。

这一阶段交付的是可执行 Harness、发布契约和运维手册，不代表公司升级已经通过。真实结论仍要求公司 Linux、内部 Provider、两个 TLS MySQL 验收数据库、上一稳定发布包和受控维护窗口。

## 已确认方案

采用“升级前备份 → 候选版本升级 → 独立空库恢复 → 旧版本回滚验证”。

不采用原地数据库降级。MySQL Migration 是只前进模型：候选版本执行新 Migration 后，旧版本遇到更高 Schema 会以 `DATABASE_SCHEMA_TOO_NEW` 失败关闭。任何通过删除 `schema_migrations`、手工反向 DDL 或忽略版本检查实现的回滚都不受支持。

不在本阶段引入完整蓝绿双写或数据库复制。团队规模不超过 20 人，首版内网部署优先选择维护窗口内的可恢复切换；未来若需要零停机，再独立设计流量切换和数据同步。

## 发布单元

每个不可变发布目录必须包含 `release-manifest.json`：

```json
{
  "schemaVersion": 1,
  "gitSha": "40-character-lowercase-git-sha",
  "appVersion": "1.0.0",
  "mysqlSchemaVersion": 14
}
```

- `gitSha` 必须是 40 位小写十六进制，不允许使用分支名或可变标签。
- `appVersion` 必须与该发布目录的 `package.json` 一致。
- `mysqlSchemaVersion` 必须等于该发布代码 `MYSQL_MIGRATIONS` 的最高版本。
- Manifest 不包含构建主机、路径、Provider、数据库、账号或时间戳，因而可以提交、复制和比较。
- 上一稳定发布与候选发布目录必须是不同的绝对目录，均不得是符号链接；入口脚本、Manifest、`package.json` 与构建后的 `dist/web/index.html` 必须存在。

仓库提供 Manifest 生成/校验命令。生成时由 CI 或发布人员显式传入 Git SHA；校验时重新读取本目录的 package version 和 Migration 最高版本，拒绝篡改或错包。

## 升级分类

比较上一稳定版本与候选版本的 `mysqlSchemaVersion`：

- `code-only`：版本相同，但不代表业务数据语义向后兼容。本 Harness 仍只执行升级前备份恢复路径，不自动让旧代码连接候选已写入的源库。
- `schema-forward`：候选版本更高。旧代码只能连接升级前备份恢复出的 rollback 数据库，禁止连接已迁移的源库。
- 候选 Schema 低于上一稳定版本：拒绝执行，错误码 `PRODUCTION_UPGRADE_SCHEMA_DOWNGRADE`。
- Git SHA 相同：拒绝执行，错误码 `PRODUCTION_UPGRADE_RELEASE_CONFLICT`，避免把重启冒充升级。

## 环境与门禁

新命令 `npm run test:production:upgrade-rollback` 必须精确开启 `WORKBENCH_PRODUCTION_UPGRADE_ROLLBACK_ACCEPTANCE=1`，并复用 Linux、非 root、Secure Cookie、受保护 OpenCode Provider和固定 4 Worker × 5 槽位门禁。它是 P3B3 之后单独运行的发布演练，不重复 8 小时长稳，也不把另一版本产生的数据误当成上一稳定版本的升级前数据库。

额外输入：

- `WORKBENCH_PREVIOUS_RELEASE_DIR`：上一稳定发布的绝对目录。
- `WORKBENCH_CANDIDATE_RELEASE_DIR`：候选发布的绝对目录；公司执行时通常为当前解压目录。
- `WORKBENCH_PREVIOUS_RELEASE_SHA` 与 `WORKBENCH_CANDIDATE_RELEASE_SHA`：操作员预期的完整 SHA，必须与 Manifest 精确一致。
- `WORKBENCH_DATABASE_URL`：独立、空白、TLS MySQL 8.4 源库；名称同时包含 `acceptance` 与 `upgrade`。
- `WORKBENCH_ROLLBACK_DATABASE_URL`：另一个独立、空白、TLS MySQL 8.4 数据库；名称同时包含 `acceptance` 与 `rollback`。
- `WORKBENCH_ROLLBACK_MYSQL_SSL_CA_FILE`：可选的 rollback 数据库独立 CA。

源库和 rollback 库的 `host:port/database` 必须不同。Harness 不删除、清空或覆盖任何远端数据库。

## 执行流程

1. 在开始真实模型调用前校验显式 gate、两个空白数据库、两个发布 Manifest、发布目录安全性和版本关系。
2. 使用上一稳定发布自己的管理员 CLI 初始化源库；管理员密码通过 stdin，成员密码只在 Harness 内存/环境中传递。
3. 启动上一稳定发布，创建一个成员账号和三个私有 Conversation；每个 Conversation 完成三轮真实 OpenCode 请求，后两轮必须从上下文取回第一轮 marker，且不得出现跨 Conversation 串线。再创建一份带附件 canary 的私有知识记录。
4. 在上一稳定发布仍运行时，经成员重新登录读取三个 Conversation、九个 Job 的唯一终态与附件；复读成功后停止上一稳定发布，再复用现有 MySQL/附件备份实现创建升级前快照，URL 只通过环境传递。
5. 使用候选发布连接同一源库和持久目录。生产启动器完成能力检查、Migration 与 OpenCode 门禁后，经原成员账号 HTTP 复读升级前数据，再创建一个候选版本专属 Conversation marker 并完成一个真实 OpenCode Job。
6. 停止候选发布。连接 rollback 数据库，先执行 MySQL 能力检查，再要求表数量严格为 0；随后把升级前 SQL 和附件 sidecar 恢复到新的 rollback 数据根。
7. 使用上一稳定发布连接 rollback 数据库和恢复附件目录。原成员账号必须能登录、读取原三个 Conversation 和九个 Job 唯一终态，附件 canary 必须逐字节一致。
8. rollback 环境不得出现候选版本专属 Conversation marker，证明恢复点确实位于升级前，而不是把已升级数据库误称为回滚。
9. 停止所有工作台与 Worker；保留两个远端数据库供人工审计，不自动清理。

## 进程和端口模型

Harness 通过子进程启动发布目录自己的 `scripts/start-production.js`，不在当前 Node 进程中 `require` 旧版本模块，避免模块缓存和依赖串用。

- 每次只运行一个工作台发布，使用 Harness 预留的 HTTP 端口和连续 OpenCode Worker 端口块。
- 子进程工作目录固定为对应不可变发布目录；`WORKBENCH_ROOT` 与 `WEB_DIST_DIR` 指向同一发布。
- 数据库 URL、密码、Provider 凭证和账号密码只放入子进程环境，不进入 argv。
- Harness 等待 `/healthz` 成功后才发起业务验证；启动失败、提前退出、超时或健康退化都失败关闭。
- 停止先发送 `SIGTERM` 并等待有界宽限期，超时才 `SIGKILL`；无论业务断言成功或失败都必须回收子进程和 Worker。

## 数据与持久目录

- 源和 rollback 各使用明确的数据根；发布代码目录不保存可变数据。
- 上一稳定版本和候选版本在源库验证时使用同一 acceptance 数据根，以检验发布目录切换不会丢失附件和 OpenCode XDG 数据。
- rollback 使用全新的数据根和附件根，只从升级前 sidecar 恢复；不得复用候选写过的附件目录。
- 候选版本专属 marker 只写数据库，不包含秘密；成功摘要只报告其在 candidate 可见、在 rollback 不可见，不输出 marker 正文。

## 失败与恢复语义

- 任一前置门禁失败：不启动发布进程、不调用备份/恢复、不接触模型。
- 上一稳定发布无法读取升级前数据：停止，说明基线发布包或数据库不匹配。
- 候选 Migration 或启动失败：停止候选，执行 rollback 恢复验证；Harness 最终仍返回失败，不能因回滚成功把升级判为成功。
- 候选业务验证失败：同样执行 rollback 恢复验证，并同时记录 `upgradeVerified: false`、`rollbackVerified: true/false`。
- rollback 目标非空或能力不兼容：不执行 restore，整体失败。
- rollback 恢复或旧版本复读失败：整体失败，禁止开放访问。

错误和诊断只使用稳定代码，不拼接底层异常详情。成功摘要最多包含：

```json
{
  "enabled": true,
  "releaseChanged": true,
  "upgradeMode": "code-only|schema-forward",
  "upgradeVerified": true,
  "rollbackVerified": true,
  "databaseRestored": true,
  "attachmentRestored": true,
  "candidateMarkerExcluded": true,
  "persistedJobs": 9
}
```

不得输出 SHA、版本目录、端口、PID、账号、Cookie、Prompt、回复、marker、数据库 URL、主机、库名、CA 或 Provider 配置路径。完整 SHA 只由操作员在受控发布记录中保存，不进入 Harness 标准输出。

## 测试策略

- Manifest 单测：有效生成/校验、SHA/version/schema 不一致、符号链接和不安全目录。
- Profile 单测：精确 gate、两个独立空白 TLS acceptance 数据库、upgrade/rollback 命名、发布冲突和 Schema 降级。
- 进程控制单测：argv 脱敏、健康等待、提前退出、SIGTERM/SIGKILL 和 finally 清理。
- Orchestrator 行为测试：严格的 previous-read → backup → candidate → empty-check → restore → previous-rollback 顺序。
- 失败路径：候选启动/Migration/业务验证失败后仍执行 rollback；非空目标绝不调用 restore；所有已启动进程都停止。
- 数据合同：三个 Conversation 的九个 Job 在 candidate 和 rollback 可读，候选 marker 只在 candidate 可见，九个 Job 仍各有唯一终态，附件字节一致。
- 兼容回归：现有 capacity、recovery、soak、DR 命令和默认 skip 行为不变。
- 最终门禁：聚焦测试、`npm test`、`npm run build`、`npm run check`、`npm run security:scan`、`git diff --check`；Mac 显式命令必须在 Linux gate 失败。

## 文档与验收口径

README、Product Goal、Roadmap、公司交接清单和内网部署手册应说明：

- P3B4 代码完成仅表示升级/回滚 Harness 已就绪。
- 公司必须提供上一稳定发布包、候选发布包、两个独立空白验收数据库、MySQL 8.4 客户端、内部 Provider 和维护窗口。
- 真实运行必须记录两个完整 Git SHA、Migration 版本、备份摘要、耗时和安全错误码，但不记录秘密或业务正文。
- 云快照/PITR、宿主机故障、Nginx 切流、安全复核和人工上线签字仍是独立外部证据。

## 非目标

- 不实现 MySQL 反向 Migration。
- 不自动修改 `/opt/opencode-ia`、systemd unit、Nginx upstream 或生产流量。
- 不自动删除任何发布目录、数据库、备份或附件。
- 不承诺零停机、RPO、RTO 或模型 Provider SLA。
- 不把 Mac、模拟、单测或 Harness 就绪表述为公司升级成功。
