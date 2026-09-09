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

### Stage 2E.7：工具、文件与产物隔离

1. 新增集中式 Workspace Tool Policy：保留管理员更严格的 OpenCode 配置，同时强制 `external_directory`、Bash、联网和子代理为 deny；Prompt 同步关闭对应工具，形成配置层与请求层双门禁。
2. 常驻 Runtime 默认使用 OpenCode `--pure`，阻止未经工作台治理的外部插件绕过标准工具权限；不把浏览器输入映射为命令参数或宿主机路径。
3. 为两个账号、多个 Conversation 验证服务端派生目录唯一、目录权限收紧、产物只写入所属目录；路径逃逸和中间软链接继续由 realpath 边界拒绝。
4. 增加 opt-in 真实 OpenCode 工具验收：核对 Runtime 生效权限，并尝试工作区内产物与跨工作区 canary；不得读取其他 Conversation 内容。
5. 完整回归、构建、语法、密钥与 diff 检查通过后更新 README、路线图、架构和验收报告，中文提交并推送；Stage 2E 只声明应用级隔离，Linux OS 沙箱仍留 Stage 5。

## Architecture Summary

### Stage 2E 运维拆分

先交付 2E.2a 管理员 API（健康、Worker、最近 200 条任务元数据、取消与审计），再交付可视化页面。通过现有认证、管理员角色和写请求 CSRF 中间件；禁止返回私人标题、正文、幂等键和连接凭据。定向验证未登录/成员拒绝、健康降级、取消幂等、所有者归属、失败脱敏和审计；随后运行全量测试、构建、语法检查、密钥扫描。该 API 子阶段不代表 2E 完成，不改变已确认架构。

Express 业务服务持有一个 Gateway 控制面，Gateway 通过 SQLite 保存 Conversation、Job、Worker、OpenCode Session 和有界事件记录。Worker Manager 启动两个带随机 Basic Auth 密码、只监听回环地址的 `opencode serve` 进程；OpenCode Client 直接使用其 HTTP/SSE API。公平队列只分配健康且有容量的 Worker，并保持 `Conversation → OpenCode Session → Worker` 粘性映射。

## Review Mode

由于当前任务未获授权派发子代理，架构、产品、测试、安全和运维复核在 `02-plan-review-rounds.md` 中内联完成。实现前仍需用户确认此计划门禁。
