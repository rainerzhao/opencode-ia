# Stage 2 Plan Review Rounds

## Round 1

### Architecture Review

**Verdict:** APPROVED

- REST/SSE 直连优于以 `opencode run --attach` 作为主链路：它避免每消息额外创建 CLI 客户端进程，并直接覆盖 Session、事件和停止协议。
- 已把 OpenCode 版本兼容、Worker 生命周期、粘性映射和持久状态拆为独立模块，避免继续扩大 `src/create-workbench-server.js`。
- Stage 2 不夹带 Skill 中心和知识版本化，子项目边界清晰。

### Test Strategy Review

**Verdict:** APPROVED

- 计划先使用可控的假 OpenCode HTTP/SSE 服务验证所有自动化行为，再以显式开关运行真实 OpenCode 冒烟测试，避免普通测试调用模型。
- 已覆盖状态机非法转换、调度公平性、同 Session 串行、Worker 崩溃、Gateway 重启和事件补发。
- 2E 包含 20 用户并发验收，且不以单次手工聊天代替恢复和隔离验证。

### Product Review

**Verdict:** APPROVED

- 多用户实时对话、持久 Conversation 和常驻 Gateway 的产品状态被分开表达，不会把基础 WebSocket 会话误报为完整能力。
- 管理员只看任务元数据，私人正文仍遵循默认私有原则。
- 队列、停止、中断和恢复边界都有明确用户可见状态。

### Security and Operations Review

**Verdict:** APPROVED

- Worker 仅监听回环地址，并使用每次启动随机生成、只驻留内存的 Basic Auth 密码。
- 工作目录由服务端生成和校验；客户端不能提供宿主机路径。
- 未知结果的任务重启后转为 `interrupted`，不会自动重放有副作用任务或误报成功。
- Provider 密钥仍只属于 OpenCode 运行环境。

## Adjudication

Round 1 没有 `BLOCKER`、`IMPORTANT` 或 `QUESTION`。计划可以进入用户确认门禁；确认后从 Stage 2A 按测试先行开始实现。
