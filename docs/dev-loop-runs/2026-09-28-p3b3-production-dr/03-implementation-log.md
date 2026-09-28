# Implementation Log

## Baseline finding

P3B1/P3B2 已覆盖真实 OpenCode Worker 强杀、整机重启、MySQL 历史复读与显式长稳，但仍没有一条把完整验收数据和附件恢复到第二个数据库后、再由生产应用读取的受控路径。

## TDD cycles

1. 新增 DR profile 测试，先要求四重精确 gate、独立 TLS recovery acceptance 目标库、独立 CA 与脱敏冻结输出；首次运行因模块不存在而 RED。
2. 实现 profile 后得到 3 pass / 1 fail；失败暴露同库冲突被目标命名检查遮蔽，调整校验顺序后 4/4 GREEN。
3. deployment contract 先要求新命令、空库查询、既有 backup/restore 入口、HTTP 恢复验证与安全结果字段；首次 4 pass / 1 fail。
4. 将 DR 串入既有 capacity → Worker recovery → workbench restart/history → soak 生命周期后，contract 5/5 GREEN；普通 production integration 继续默认 skip。
5. 独立代码审查发现自定义附件根、目标能力检查时机和字符串契约不足三个 IMPORTANT；新增可注入 runner 与 3 个行为测试，逐项修正后聚焦 12 pass / 1 skip。
6. Mac 显式运行 DR 命令按设计在 Linux 门禁失败，未接触任何远端数据库。

## Implementation

- `src/gateway/production-dr-profile.js`：复用完整 soak profile；额外要求 DR 精确 gate、第二个 TLS 数据库、`acceptance` + `recovery`/`restore` 命名与源/目标身份不同，仅返回脱敏 profile。
- `test/integration/production-capacity.test.js`：显式固定隔离的 acceptance 附件根，长稳结束并停止源工作台后调用 DR runner。
- `test/fixtures/production-dr-acceptance.js`：从同一 `loadConfig` 读取应用实际附件根，写入 canary 并复用 `backup-mysql` 导出 SQL 与附件 sidecar。
- 目标数据库先完成 MySQL 8.4/字符集/时区/ngram 能力检查，再经 `information_schema.tables` 确认表数为 0；任一步失败都关闭连接，非空不执行 restore，也不自动清理。
- 目标连接串只经 `WORKBENCH_RECOVERY_DATABASE_URL` 进入恢复环境；目标 CA 可独立配置。调用 `restore-mysql --confirm` 后，以独立数据根、附件根和 XDG 目录启动同一 MySQL production composition。
- 恢复后的工作台使用原成员账号登录，经 HTTP 读取原 Conversation 与完整事件历史，要求 P3B1 五个 Job 各有且只有一个终态，并逐字节核验附件 canary。
- DR 诊断字段只报告 `enabled`、`databaseRestored`、`attachmentRestored` 和 `persistedJobs`，不包含 URL、库名、主机、路径、账号、PID、Prompt、回复、Cookie 或密钥。

## Safety and product rulings

- Harness 不删除、清空或覆盖远端数据库；源库和目标库都由平台侧提供与保留。
- 空库检查先于 restore；目标库命名和 TLS/独立性门禁先于完整长稳，避免长时间调用后才发现配置错误。
- 应用级 SQL/附件恢复只证明工作台数据可迁移、可由应用复读，不等于云快照/PITR、高可用、跨可用区或宿主机灾备。
- OpenCode Session 状态不作为此次恢复通过条件；持久 Conversation、Job 终态与附件是本阶段恢复合同。

## Verification

- DR profile + runner behavior + deployment contract + default integration：12 pass / 0 fail / 1 skip。
- `npm test`：438 total / 413 pass / 0 fail / 25 skip。
- `npm run build`：41 modules transformed。
- `npm run check`：214 files passed。
- `npm run security:scan`：no findings。
- `git diff --check`：通过。
- Mac 显式 DR 命令：按设计失败，错误码 `PRODUCTION_CAPACITY_LINUX_REQUIRED`。

## Git delivery

待本阶段提交与推送后补充 SHA；公司 Linux、内部 Provider、云 MySQL 双库和真实 8 小时运行仍待外部环境。
