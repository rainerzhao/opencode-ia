# Requirements Baseline

## Goal

在完整生产长稳 Harness 结束后，将 MySQL acceptance 数据与附件副本备份并恢复到第二个全新 TLS recovery 数据库/目录，再由恢复后的 production workbench 通过账号登录和 HTTP 历史读取证明数据可用。

## Non-goals

- 不模拟云数据库供应商的 PITR、跨可用区切换或高可用 SLA。
- 不自动删除、清空或覆盖源/目标数据库。
- 不把本机脚本测试或 Harness 就绪表述为公司灾备通过。
- 不覆盖升级/代码版本回滚；该项属于下一阶段。

## User-visible Behavior

- 原容量、恢复和长稳命令保持不变。
- 新增显式 DR 命令，要求第二个空白、TLS、名称同时包含 `acceptance` 与 `recovery`/`restore` 的数据库。
- 长稳完成并停止源工作台后，调用现有 MySQL/附件备份与恢复实现；恢复目标为空才允许写入。
- 恢复后的工作台重新登录已有账号、读取同一 Conversation 与五个已接受任务的唯一终态，并核验附件 canary 摘要。

## Acceptance Criteria

1. 必须精确开启 capacity、recovery、soak、DR 四个 gate；继续要求 Linux、生产拓扑和显式长稳时长。
2. 源/目标均为 TLS MySQL，目标名称同时含 acceptance 与 recovery/restore，且源/目标端点+库名不得相同。
3. 目标数据库存在任何表时失败，不自动清理。
4. 备份使用现有 `backup-mysql` 的原子 SQL/附件 sidecar 与摘要；恢复使用现有 `restore-mysql --confirm` 语义，URL 不进入命令参数。
5. 恢复后的 production workbench 能用原账号登录并读取原 Conversation。
6. P3B1 选定的五个 Job 在恢复后仍各有且只有一个持久终态。
7. 附件 canary 恢复后字节一致；备份/恢复临时文件只存在于 Harness 临时根。
8. 成功摘要只输出 `databaseRestored`、`attachmentRestored` 与安全计数，不输出 URL、库名、主机、路径、账号、PID、Prompt、回复、Cookie 或密钥。
9. README、Goal、Roadmap 和运维文档标记“应用级 DR Harness 已就绪；公司云快照/PITR 与实跑待完成”。

## Constraints

- 不重复实现备份/恢复算法，直接复用已测试脚本。
- OpenCode 仍是唯一 Runtime；恢复后启动相同 production composition。
- 不派生评审代理；采用结构化内联复核。

## Assumptions

- 公司预发布提供 MySQL 8.4 `mysql`/`mysqldump` 客户端与两个独立空白数据库。
- 两个数据库可使用相同 CA；若不同，通过独立 target CA 环境变量提供。

## Open Questions

无阻塞问题。云平台 PITR 与升级回滚不能由此 Harness 替代，继续保留为显式外部证据。

## Source Request

继续完成 Stage 5E 的数据库/附件恢复与灾备验收准备。

## Repo Context

- Base SHA: `22e9e1f`
- Branch: `main`
- P3A1、P3B1、P3B2 已推送。
- 4 份既有无关未跟踪材料继续保留且不纳入本阶段。
