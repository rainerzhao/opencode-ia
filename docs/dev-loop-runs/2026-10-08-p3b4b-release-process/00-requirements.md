# Requirements Baseline

## Goal
实现 P3B4B 独立发布进程生命周期，供双库升级/回滚 Harness 使用。
## Non-goals
不进行 MySQL 迁移、模型调用或生产流量切换；不宣称跨版本升级验收通过。
## User-visible Behavior
后续验收能等待发布健康，失败安全退出，回收同进程组后台进程。
## Acceptance Criteria
自己的发布入口/cwd/env；凭证不进入 argv 或日志；健康必须含数据库与 Gateway；超时、提前退出、优雅退出与强制回收均有真实子进程证据。
## Constraints
POSIX 进程组，受信发布包，显式环境；逃逸进程组不在能力承诺内。
## Assumptions
延续已批准的自动分阶段实施，内联复核，不新增审批或子代理。
## Open Questions
双库编排与生产应用优雅停服联调留 P3B4C。
## Source Request
继续已确认 P3B4，并逐阶段测试、README 更新和推送。
## Repo Context
基线 839c08e/main；无关未跟踪文件不改动。
