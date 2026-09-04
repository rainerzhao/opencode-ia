# Stage 2 OpenCode Gateway Plan

详细逐文件计划见：`../../superpowers/plans/2026-09-04-stage-2-opencode-gateway.md`。

## Delivery Sequence

| Git 阶段 | 可独立交付能力 | 主要验证 | 推送点 |
| --- | --- | --- | --- |
| 2A | Gateway 状态机、SQLite 数据模型与稳定事件契约 | 迁移、约束、所有权、状态转换测试 | `main` 提交 1 |
| 2B | 单个受保护的常驻 OpenCode Worker 与 HTTP/SSE 客户端 | 进程生命周期、健康、Session、消息、停止测试 | `main` 提交 2 |
| 2C | 2 Worker 池、粘性 Session 与按用户公平队列 | 并行、串行、公平性、限流、Worker 故障测试 | `main` 提交 3 |
| 2D | Conversation API、WebSocket 续传与前端多会话体验 | 两用户隔离、取消、重连补发、浏览器验收 | `main` 提交 4 |
| 2E | 重启恢复、健康后台、20 用户压测与真实 OpenCode 冒烟 | 恢复演练、并发、真实链路、完整回归 | `main` 提交 5 |

## Architecture Summary

Express 业务服务持有一个 Gateway 控制面，Gateway 通过 SQLite 保存 Conversation、Job、Worker、OpenCode Session 和有界事件记录。Worker Manager 启动两个带随机 Basic Auth 密码、只监听回环地址的 `opencode serve` 进程；OpenCode Client 直接使用其 HTTP/SSE API。公平队列只分配健康且有容量的 Worker，并保持 `Conversation → OpenCode Session → Worker` 粘性映射。

## Review Mode

由于当前任务未获授权派发子代理，架构、产品、测试、安全和运维复核在 `02-plan-review-rounds.md` 中内联完成。实现前仍需用户确认此计划门禁。
