# Acceptance Report

## Verdict

PASS_WITH_NOTES：P3B3 应用级 DR Harness 的配置门禁、空库保护、既有备份/恢复复用、恢复后账号/HTTP 历史读取、附件 canary 与脱敏文档已通过本机可执行验收。公司 Linux + 云 MySQL 双库 + 内部 Provider 的真实 8 小时运行和恢复尚未发生，因此 P3B、Stage 5E 与整体 Goal 均不能关闭。

## Scope Checked

- Requirements：逐项核对 9 条验收标准。
- Test coverage：profile RED→GREEN、integration contract、默认 skip、Mac 失败关闭与全量回归。
- Code quality：生命周期顺序、数据库连接关闭、Worker 停止、独立数据根、唯一终态与附件字节核验。
- Security：四重 opt-in、TLS/独立目标、空库失败关闭、URL 只经 env 传递、无自动清理和诊断脱敏。
- Operations：MySQL 8.4 客户端、双数据库、目标 CA、受控备份目录和公司执行顺序。
- Compatibility：原容量、恢复、长稳命令、API、Schema 与生产组合不变。

## Tests Run

| Command | Result |
| --- | --- |
| DR profile + runner behavior + deployment contract + default integration | 12 pass / 0 fail / 1 skip |
| `npm test` | 438 total / 413 pass / 0 fail / 25 skip |
| `npm run build` | Pass，41 modules transformed |
| `npm run check` | Pass，214 files |
| `npm run security:scan` | Pass，no findings |
| `git diff --check` | Pass |
| DR command on Mac | Expected fail：`PRODUCTION_CAPACITY_LINUX_REQUIRED` |

## Requirement Coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| 四个精确 gate 与 Linux/生产边界 | DR profile 复用 soak/capacity 并增加 DR gate | Pass |
| 独立 TLS recovery acceptance 目标 | profile 单测覆盖协议、命名、同库冲突与 CA | Pass |
| 非空/不兼容目标拒绝 | restore 前先做能力检查，再查询 `information_schema.tables` 并断言 0；行为测试证明失败短路和连接关闭 | Pass（行为契约）；公司实跑待完成 |
| 复用备份/恢复且 URL 不进 argv | 直接调用既有 `backupMySql` / `restoreMySql`，URL 仅在 env | Pass（代码契约） |
| 原账号登录与 Conversation HTTP 读取 | 恢复后的 production workbench 登录并读取详情/事件 | Ready，公司实跑待完成 |
| 五个 Job 唯一终态 | 恢复历史按 Job 逐一断言一个 terminal event | Ready，公司实跑待完成 |
| 附件字节一致 | 64-byte canary 经 sidecar 恢复后 `deepEqual` | Ready，公司实跑待完成 |
| 安全摘要 | DR 结果仅四个安全字段 | Pass（代码契约） |
| 产品与运维边界 | README/Goal/Roadmap/operations 区分应用级 DR 与云灾备 | Pass |

## Findings and Fixes

- IMPORTANT：同一源/目标数据库应优先报冲突，而不是被目标命名规则遮蔽——解析成功后先比较 endpoint/database identity。
- BLOCKER：不能向未知状态目标恢复——restore 前连接目标并要求表数量严格为 0。
- BLOCKER：数据库 URL 不得进入 argv、诊断和文档示例——只通过受保护环境传递。
- IMPORTANT：命令退出码不足以证明恢复可用——恢复后必须由真实 production composition 登录并经 HTTP 读取。
- IMPORTANT：数据库恢复不能代表附件恢复——加入独立 sidecar canary 字节核验。
- IMPORTANT：自定义附件根不能被默认路径绕过——从同一 `loadConfig` 读取源应用配置，并在 Harness 启动时显式隔离附件根。
- IMPORTANT：字符串契约不能证明顺序和清理——抽出可注入 runner，以行为测试验证能力检查/空库检查/restore 顺序、非空短路与失败 stop。

## Residual Risks

- 公司云 MySQL 的网络、证书、权限、`mysql`/`mysqldump` 版本和大数据量耗时只有真实环境能验证。
- 空库检查与 restore 之间仍依赖验收窗口独占目标库；平台需禁止其他写入者并保留运行审计。
- 此入口不是云平台快照/PITR、跨可用区高可用、宿主机故障或备份保留策略的替代品。
- OpenCode XDG/Session 恢复不在此 DR 合同内；恢复后保留持久历史，但后续推理可能建立新的 Runtime Session。
- 升级/代码版本回滚、安全复核、告警送达和人工上线签字仍未完成。

## Follow-ups

1. 公司 Linux 准备两个独立空白验收数据库和受控附件目录，以 480 分钟/900 秒参数运行 `npm run test:production:dr`。
2. 同时执行云快照/PITR 恢复、宿主机故障和升级回滚演练，并将证据关联同一 Git SHA/时间窗。
3. 完成安全复核与人工上线签字后，才可评估关闭 Stage 5E 与整体 Goal。
