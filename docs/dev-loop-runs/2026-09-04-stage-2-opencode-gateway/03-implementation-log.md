# Stage 2 Implementation Log

## Stage 2A：持久化 Gateway 底座

### Delivered

- SQLite migration 2：`conversations`、`gateway_workers`、`opencode_sessions`、`gateway_jobs`、`gateway_events`。
- 私人 Conversation 所有权、一个 Conversation 对应一个 OpenCode Session 映射、用户级幂等键和严格状态约束。
- `queued → running → terminal` 任务状态机，拒绝回滚和终态二次修改。
- Gateway Store：Conversation、Job、Worker、Session Binding、事件补发和启动恢复事务。
- Gateway 公共事件类型；事件使用数据库自增序号，支持后续 WebSocket 续传。
- 启动恢复把未知结果的 `running` Job 标记为 `interrupted`，保留排队与终态任务，不自动重放。

### TDD Evidence

1. `test/db/gateway-database.test.js` 首次运行：3 项失败，原因为 migration 2 和 Gateway 表不存在；实现后 3/3 通过。
2. `test/gateway/job-state.test.js` 首次运行：模块不存在；实现后 3/3 通过。
3. `test/gateway/gateway-store.test.js` 首次运行：模块不存在；实现后 5/5 通过。
4. 新增标题控制字符回归用例先失败，收紧字符串校验后 5/5 通过，同时保留 Job 多行输入。

### Review Notes

- 数据迁移只新增表，不修改 Stage 1 用户、登录 Session 和审计表。
- `input_text` 是恢复排队任务所必需的私人数据，只能由后续所有权 API 返回给创建者；管理员视图不得返回该字段。
- Worker 端点允许持久化，但密码没有字段，后续 Stage 2B 的随机 Basic Auth 密码只能驻留进程内存。
- Stage 2A 尚未接入现有聊天 WebSocket，因此 README 明确标记为数据与协议底座，而不是常驻 Gateway 已可使用。

### Verification

- `npm test`：129/129 通过。
- `npm run build`：Vite production build 通过，37 modules transformed。
- `npm run check`：64 个仓库 JavaScript 文件语法检查通过。
- `npm run security:scan`：无发现。
- `git diff --check`：首次发现架构文档一处行尾空格；修正后重新执行并通过。
