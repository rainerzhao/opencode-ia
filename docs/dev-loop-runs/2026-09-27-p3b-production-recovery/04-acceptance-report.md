# Acceptance Report

## Verdict

PASS_WITH_NOTES：P3B1 生产恢复 Harness 的代码、失败关闭门禁、默认兼容性、脱敏边界和交接文档已通过本机可执行验收。公司 Linux + 云 MySQL + 内部 Provider 上的真实故障演练尚未发生，因此 P3B、Stage 5E 与整体 Goal 均不能关闭。

## Scope Checked

- Requirements acceptance：逐项核对 `00-requirements.md` 的 7 条标准。
- Test coverage：RED/GREEN、默认 skip、Mac 显式失败关闭和全量回归。
- Code quality：真实 Worker 定位、运行/排队竞态、进程替换、资源关闭、同配置重建和终态唯一性。
- Security：专用数据库、无自动清库、诊断脱敏和 owner-only HTTP 历史读取。
- Operations：完整命令可直接纳入公司 Linux 交接顺序，且不将 Harness 就绪误报为生产通过。
- Compatibility：原 `test:capacity:20:production` 的容量语义与现有 API/Schema 不变。

## Tests Run

| Command | Result |
| --- | --- |
| `node --test test/ops/deployment-contract.test.js` | 3 pass / 0 fail |
| `node --test test/integration/production-capacity.test.js` | 1 skip，符合 opt-in 设计 |
| `npm test` | 424 total / 399 pass / 0 fail / 25 skip |
| `npm run build` | Pass，41 modules transformed |
| `npm run check` | Pass，207 files |
| `npm run security:scan` | Pass，no findings |
| `git diff --check` | Pass |
| `npm run test:production:acceptance` on Mac | Expected fail：`PRODUCTION_CAPACITY_LINUX_REQUIRED` |

## Requirement Coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| 纯容量命令不注入故障 | recovery 由独立精确环境开关控制 | Pass |
| 真实 Worker 强杀 | 运行任务绑定 Worker 后发送 `SIGKILL` | Ready，Linux 实跑待完成 |
| 运行任务安全中断 | 等待对应 `job.interrupted` | Ready，Linux 实跑待完成 |
| 新进程恢复 healthy | 同 Worker ID 的进程必须更换 | Ready，Linux 实跑待完成 |
| Session 恢复或安全边界 | marker 完成或 interrupted + recovery boundary | Ready，Linux 实跑待完成 |
| 整机重启后历史完整 | 同一 MySQL 重建、重新登录、HTTP 读取五个唯一终态 | Ready，Linux 实跑待完成 |
| 交接口径真实 | README/Goal/Roadmap/operations 标记 Harness 就绪、公司待验收 | Pass |

## Findings and Fixes

- BLOCKER：恢复证据不能只依赖内存对象——增加整套 workbench 重建与认证 HTTP 历史读取。
- BLOCKER：故障输出不能泄露进程或模型数据——摘要仅保留布尔值、恢复模式和计数。
- IMPORTANT：Session 不可恢复不是自动失败，但必须显式形成 recovery boundary 并中断排队任务。
- IMPORTANT：容量使用者不应被隐式注入故障——保留原命令，新增完整生产验收命令。
- IMPORTANT：OpenCode Session 状态要跨 workbench 生命周期——为 Harness 使用持续到测试结束的 XDG 数据与缓存目录。

## Residual Risks

- 公司 Provider 响应速度、限流或连接行为可能影响故障注入窗口；任何无运行态、无终态或 401/403/429 都应保留为失败证据。
- 本 Harness 只强杀一个 OpenCode Worker，不替代云 MySQL 中断、附件备份恢复、宿主机重启、升级回滚和长稳测试。
- Session 恢复能力依赖公司 Linux 服务账号的持久 XDG 目录和实际 OpenCode 版本，必须在预发布机确认。
- acceptance 数据会保留在专用数据库中用于审计，生命周期和最终清理由平台团队负责。

## Follow-ups

1. 在公司 Linux 预发布机运行 `npm run test:production:acceptance` 并保存脱敏结果。
2. 继续完成 MySQL/附件备份恢复、宿主机重启、升级回滚和长时间运行验收。
3. 所有生产证据齐全并人工确认残余风险后，才关闭 P3B 与整体 Goal。
