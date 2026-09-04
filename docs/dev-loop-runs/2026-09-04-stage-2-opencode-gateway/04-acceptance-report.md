# Stage 2 Acceptance Report

## Overall Verdict

**IN PROGRESS** — Stage 2A–2C 通过验收；Stage 2D 的私人 Conversation API 已通过，实时协议与 UI 尚未完成；Stage 2E 尚未开发。

## Stage 2A Verdict

**PASS**

## Stage 2B Verdict

**PASS**

## Stage 2C Verdict

**PASS**

## Scope Checked

- 从现有 migration 1 数据库升级到 migration 2，不丢失用户数据。
- Gateway 五类持久化对象、外键、状态约束、唯一映射和幂等约束。
- Job 合法状态转换、终态不可变和错误转换拒绝。
- Conversation 所有权、Job 幂等提交、Worker 元数据和 OpenCode Session 粘性绑定。
- 有序事件追加、所有者事件读取和启动恢复。
- Stage 1 认证、权限、文件安全、Demo、React 构建和 WebSocket 回归。
- SSE 流边界、OpenCode HTTP 契约、Worker 安全启动、健康、版本、异常退出和停止清理。
- 本机真实 OpenCode 1.18.25 的无模型启动、健康和停止冒烟。
- 双 Worker 容量、Conversation 粘性、心跳摘除与重启、干净停止及非敏感元数据持久化。
- 按用户 round-robin、公平跳过、同用户 FIFO、排队上限、取消、超时和幂等提交。
- 同 Conversation 串行、不同用户并行、Worker 故障仅中断受影响 Job。
- 20 用户确定性模拟，无饥饿且全局并发不超过 2、单用户并发不超过 1。

## Reviewers Run

- Requirements acceptance：Stage 2A–2C 的持久状态、受保护 Worker、双 Worker 调度、公平队列、限流和故障隔离均有实现与测试证据。
- Test coverage：新行为经过 RED → GREEN；完整回归 166/166 通过，并包含 20 用户确定性模拟。
- Code quality：Store、进程监管、OpenCode Client、Worker Pool、公平队列和 Gateway Service 职责分离；内联复核发现的问题均先补回归再修复。
- Security：私人 Job 输入不进入管理员接口；Worker 密码没有数据库字段；工作目录由服务端派生并经过既有安全路径策略。
- Docs/migration：README、路线图和架构状态明确区分 Stage 2C 服务端底座与 Stage 2D 用户可见接入。

## Tests Run

- `node --test --test-concurrency=1 test/db/gateway-database.test.js`：3/3。
- `node --test --test-concurrency=1 test/gateway/job-state.test.js`：3/3。
- `node --test --test-concurrency=1 test/gateway/gateway-store.test.js`：5/5。
- `node --test --test-concurrency=1 test/gateway/sse-parser.test.js`：5/5。
- `node --test --test-concurrency=1 test/gateway/opencode-client.test.js`：4/4。
- `node --test --test-concurrency=1 test/gateway/worker-process.test.js`：7/7。
- Stage 2C 定向测试：32/32。
- `npm test`：166/166。
- `npm run build`：通过，37 modules transformed。
- `npm run check`：通过，78 files。
- `npm run security:scan`：通过，无发现。
- `git diff --check`：通过。

## Requirement Coverage

- Stage 2A：通过。
- Stage 2B 单 Worker：通过。
- Stage 2C Worker 池与队列：通过。
- Stage 2D 多会话产品链路：未开始。
- Stage 2E 恢复与总验收：未开始。

## Findings and Fixes

- 完整回归首次发现旧数据库测试固定假设只有 migration 1；已改为验证所有已知 migration 只执行一次。
- `git diff --check` 首次发现一处新增行尾空格；已修正并复验。
- 代码复核发现 Conversation 标题原本会接受换行控制字符；增加先失败的回归测试后收紧校验，同时保留 Job 正文的多行输入。
- Stage 2C 集成测试发现 Worker 元数据持久化、队列溢出孤儿 Job、Session 初始化失败状态和停止状态同步问题；均增加 RED 用例后修复。

## Residual Risks

- Stage 2A 尚未进入 Express 运行链路，现有聊天仍使用每消息一次 `opencode run`。
- 浏览器多会话、断线续传和用户可见恢复边界由 Stage 2D 验证。
