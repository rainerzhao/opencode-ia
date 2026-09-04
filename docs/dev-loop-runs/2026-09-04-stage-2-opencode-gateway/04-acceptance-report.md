# Stage 2 Acceptance Report

## Overall Verdict

**IN PROGRESS** — Stage 2A 通过验收；Stage 2B–2E 尚未开发，不能把常驻 Gateway 标记为整体完成。

## Stage 2A Verdict

**PASS**

## Scope Checked

- 从现有 migration 1 数据库升级到 migration 2，不丢失用户数据。
- Gateway 五类持久化对象、外键、状态约束、唯一映射和幂等约束。
- Job 合法状态转换、终态不可变和错误转换拒绝。
- Conversation 所有权、Job 幂等提交、Worker 元数据和 OpenCode Session 粘性绑定。
- 有序事件追加、所有者事件读取和启动恢复。
- Stage 1 认证、权限、文件安全、Demo、React 构建和 WebSocket 回归。

## Reviewers Run

- Requirements acceptance：Stage 2A 的 Schema、状态机、Store、事件协议和恢复语义均有实现与测试证据。
- Test coverage：新行为经过 RED → GREEN；完整回归 129/129 通过。
- Code quality：数据访问集中在 Store，状态转换集中在纯函数，公共事件类型独立于 Express 和 Worker 实现。
- Security：私人 Job 输入不进入管理员接口；Worker 密码没有数据库字段；所有权读取默认失败关闭。
- Docs/migration：README、路线图和架构状态区分 Stage 2A 底座与尚未接入的常驻 Worker。

## Tests Run

- `node --test --test-concurrency=1 test/db/gateway-database.test.js`：3/3。
- `node --test --test-concurrency=1 test/gateway/job-state.test.js`：3/3。
- `node --test --test-concurrency=1 test/gateway/gateway-store.test.js`：5/5。
- `npm test`：129/129。
- `npm run build`：通过，37 modules transformed。
- `npm run check`：通过，64 files。
- `npm run security:scan`：通过，无发现。
- `git diff --check`：通过。

## Requirement Coverage

- Stage 2A：通过。
- Stage 2B 单 Worker：未开始。
- Stage 2C Worker 池与队列：未开始。
- Stage 2D 多会话产品链路：未开始。
- Stage 2E 恢复与总验收：未开始。

## Findings and Fixes

- 完整回归首次发现旧数据库测试固定假设只有 migration 1；已改为验证所有已知 migration 只执行一次。
- `git diff --check` 首次发现一处新增行尾空格；已修正并复验。
- 代码复核发现 Conversation 标题原本会接受换行控制字符；增加先失败的回归测试后收紧校验，同时保留 Job 正文的多行输入。

## Residual Risks

- Stage 2A 尚未进入 Express 运行链路，现有聊天仍使用每消息一次 `opencode run`。
- OpenCode HTTP/SSE 协议、Worker 随机密码和进程清理由 Stage 2B 验证。
- 公平排队、并发与故障隔离由 Stage 2C 验证。
- 浏览器多会话、断线续传和用户可见恢复边界由 Stage 2D 验证。
