# Acceptance Report

## Verdict

PASS_WITH_NOTES：P3A1 生产路径容量 Harness 的代码、失败关闭门禁、文档和普通回归验收通过；公司 Linux + 云 MySQL + 内部 Provider 的真实容量执行尚未发生，P3A 与整体 Goal 均不能关闭。

## Scope Checked

- Requirements acceptance：逐项核对 `00-requirements.md` 的 6 条标准。
- Test coverage：RED/GREEN、默认 skip、Mac 显式失败关闭、全量回归。
- Code quality：生产 composition、HTTP/WebSocket、资源关闭、端口和超时边界。
- Security：非 root、TLS、受保护 Provider、专用数据库、无自动清库、脱敏输出。
- Compatibility：旧 `test:capacity:20:real` 命令与现有协议不变。

## Tests Run

| Command | Result |
| --- | --- |
| Focused profile + deployment contract | 6 pass / 0 fail |
| Default production integration | 1 skip，符合 opt-in 设计 |
| `npm test` | 423 total / 398 pass / 0 fail / 25 skip |
| `npm run build` | Pass，41 modules transformed |
| `npm run check` | Pass，207 files |
| `npm run security:scan` | Pass，no findings |
| `git diff --check` | Pass |
| Explicit production command on Mac | Expected fail：`PRODUCTION_CAPACITY_LINUX_REQUIRED` |

## Requirement Coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| MySQL production composition | Harness imports and starts `createMySqlProductionWorkbench` | Pass |
| Fixed 4×5/20/1 topology | Frozen profile + unit tests | Pass |
| 20×3×3 real task flow | Opt-in integration code and source contract | Ready, company execution pending |
| Isolation and queue checks | Marker, 404, max running/user/queued assertions | Ready, company execution pending |
| Dedicated fresh database | TLS + database name + bootstrap fail-closed | Pass |
| Truthful handoff | README/Goal/Roadmap/operations updated | Pass |

## Findings and Fixes

- IMPORTANT：原真实 Runtime Harness 不是 MySQL production path——新增独立 production Harness，文档纠正口径。
- BLOCKER：远端数据库不能自动清理——采用全新 acceptance 专用库与 bootstrap fail-closed。
- IMPORTANT：真实命令必须自行执行门禁——加入 production/provider validation。
- IMPORTANT：公司数据库链路不能明文——profile 只接受 TLS MySQL。
- IMPORTANT：单用户并发需实测而非只看配置——加入运行期 Job 采样。

## Residual Risks

- 公司 Provider 可能出现 401/403/429、超时、模型不遵循标识或不支持 20 路并发；这些必须保留为失败证据，不能降级为模拟成功。
- 连续端口预留与 Worker 启动之间仍存在操作系统级短暂竞争；发生时应保留失败并在干净窗口重跑，不修改产品拓扑。
- Harness 会在专用验收库中保留账号、会话和审计证据；数据库生命周期由平台团队管理。
- Runtime/MySQL 故障、备份恢复、升级回滚和长时间运行仍属于 P3B/Stage 5E。
