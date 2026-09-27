# Requirements Baseline

## Goal

在 P3A1 的 MySQL + 真实 OpenCode 生产路径 Harness 中增加 Worker 崩溃、自动重启、Session 恢复或安全边界，以及工作台整机重启后的完整历史读取验证。

## Non-goals

- 不主动中断公司云 MySQL，不模拟云数据库供应商故障。
- 不将本机测试表述为公司生产灾备通过。
- 不要求 Runtime 崩溃后一定恢复上下文；无法恢复时必须形成明确 recovery boundary，不能静默重放。
- 不改变业务 API、数据库 Schema 或前端行为。

## User-visible Behavior

- 纯容量命令保持不变。
- 新增完整生产验收命令，在容量测试后继续注入 Worker `SIGKILL`、验证自动重启与安全恢复，再重启工作台验证 MySQL 历史仍可读取。
- 成功摘要只记录安全的计数、恢复结果与进程是否更换，不记录 PID、Prompt、回复、Cookie、URL 或密钥。

## Acceptance Criteria

1. `test:capacity:20:production` 语义不变，不注入故障。
2. 新命令必须同时打开 capacity 与 recovery 两个精确开关。
3. 故障注入必须杀死真实 OpenCode Worker，并验证运行任务转为 `interrupted`。
4. Worker 必须以新进程自动恢复为 healthy。
5. 排队任务要么沿用原 Session 完成并保留 marker，要么被中断且产生 `conversation.recovery_boundary`。
6. 工作台停止并以同一 MySQL、数据根和 OpenCode 持久目录重启后，账号可重新登录，Conversation 与五次提交的完整终态历史可读取。
7. README、Goal、Roadmap 与公司交接文档准确标记“Harness 就绪、公司实跑待完成”。

## Constraints

- 继续要求 Linux、TLS、全新 acceptance 专用数据库、非 root、受保护 Provider 和 4×5/20/1 拓扑。
- 不自动清理远端数据库。
- 不派生评审代理；按当前协作策略做结构化内联复核。

## Assumptions

- 真实 OpenCode 在服务账号的持久 XDG 数据目录中保存 Session。
- Worker 进程退出回调和心跳能在既有超时内完成自动重启。

## Open Questions

无阻塞问题；上下文恢复和安全边界均为合法结果，但静默重放、丢失终态或历史不可读均为失败。

## Source Request

继续完成整体 Goal 中的故障恢复、完整历史、Linux/Provider/MySQL 生产验收准备。

## Repo Context

- Base SHA: `509a193`
- Branch: `main`
- P3A1 production capacity Harness 已推送。
- 4 份既有无关未跟踪材料继续保留且不纳入本阶段。
