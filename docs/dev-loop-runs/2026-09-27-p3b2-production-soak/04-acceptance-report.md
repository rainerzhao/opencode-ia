# Acceptance Report

## Verdict

PASS_WITH_NOTES：P3B2 生产长稳 Harness 的配置边界、轮转算法、集成入口、健康采样、脱敏输出和产品/运维文档已通过本机可执行验收。公司 Linux + 云 MySQL + 内部 Provider 的 8 小时真实运行尚未发生，因此 P3B、Stage 5E 与整体 Goal 均不能关闭。

## Scope Checked

- Requirements：逐项核对 8 条验收标准。
- Test coverage：profile/schedule RED→GREEN、integration contract、默认 skip、Mac 失败关闭、全量回归。
- Code quality：时间边界、cohort 覆盖、WebSocket 生命周期、会话上下文、终态处理和精确持续时长。
- Security：三重 opt-in、专用数据库、无自动清理、输出脱敏和 owner-scoped Conversation。
- Performance/operations：5 人轮转降低长稳模型成本，同时保留 20 在线连接；真实 20 活跃任务由前置容量阶段覆盖。
- Compatibility：原容量与恢复命令、API 和 Schema 不变。

## Tests Run

| Command | Result |
| --- | --- |
| Profile/schedule + deployment contract | 9 pass / 0 fail |
| Default production integration | 1 skip，符合 opt-in 设计 |
| `npm test` | 430 total / 405 pass / 0 fail / 25 skip |
| `npm run build` | Pass，41 modules transformed |
| `npm run check` | Pass，210 files |
| `npm run security:scan` | Pass，no findings |
| `git diff --check` | Pass |
| 60-minute soak command on Mac | Expected fail：`PRODUCTION_CAPACITY_LINUX_REQUIRED` |

## Requirement Coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| 三个精确 gate 与生产边界 | profile 复用 capacity gate，并要求 recovery/soak | Pass |
| 有界时长、间隔和四轮覆盖 | 纯 profile 单测 | Pass |
| 原命令兼容 | 独立 npm script 与默认 skip | Pass |
| 20 在线、5 人轮转 | schedule 单测与 integration contract | Ready，公司实跑待完成 |
| 跨轮上下文 | 首轮含 marker，后续 Prompt 不重复 marker | Ready，公司实跑待完成 |
| 任务与健康失败关闭 | terminal、marker、串线、双 health 断言 | Ready，公司实跑待完成 |
| 完整持续时长 | 最后一轮后继续采样至 duration deadline | Pass（代码契约） |
| 真实交接口径 | README/Goal/Roadmap/operations 明确公司待验收 | Pass |

## Findings and Fixes

- IMPORTANT：持续时长不能用轮次数近似——最后一轮后继续健康采样到绝对 deadline。
- IMPORTANT：20 人每轮持续请求成本过高——20 人保持在线，每轮 5 人、四轮完整覆盖。
- BLOCKER：不能由默认值误触发长稳调用——时长和间隔都必须显式设置且有上下界。
- BLOCKER：后续轮次不能靠 Prompt 再次提供 marker 冒充上下文连续——后续 Prompt 只请求第一轮标识。
- IMPORTANT：临时健康退化不能被自动重试掩盖——每次采样和任务终态均失败关闭。

## Residual Risks

- 公司 Provider 的 429、配额、网络抖动和模型上下文能力只有真实 8 小时运行才能验证。
- `/healthz` 与 Gateway health 是应用级指标，不替代宿主机 CPU/内存/FD、云 MySQL 指标和 Provider 监控。
- Harness 不覆盖 MySQL 中断、附件恢复、宿主机重启、升级回滚或告警送达，这些仍属后续 P3B/Stage 5E。
- 真实长稳会产生模型成本；运行窗口、配额和停止条件必须由公司平台团队确认。

## Follow-ups

1. 公司 Linux 以 480 分钟/900 秒参数运行 `npm run test:production:soak`，留存脱敏摘要。
2. 同时采集宿主机、云 MySQL 与 Provider 指标，关联相同 Git SHA 和时间窗。
3. 继续完成 MySQL/附件恢复、宿主机故障、升级回滚、安全复核与人工上线签字。
