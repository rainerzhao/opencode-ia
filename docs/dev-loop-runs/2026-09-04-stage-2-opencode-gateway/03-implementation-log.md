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
- GitHub：Stage 2A 提交 `50ed662` 已推送到公开仓库 `main`。

## Stage 2B：单个常驻 Worker 与 OpenCode HTTP/SSE 客户端

### Delivered

- 有界 SSE 解析器：支持任意分片、UTF-8 边界、多行 `data`、注释帧、畸形 JSON 隔离、取消和单事件大小上限。
- 仅允许回环 HTTP Origin 的 OpenCode Client：覆盖健康、Session 创建/读取、Prompt、SSE 事件订阅和 Session Abort。
- HTTP 客户端对连接和完整 JSON 响应体统一实施超时，并将取消、超时、网络、非 2xx、协议错误和版本漂移映射为稳定安全错误。
- Worker Process Supervisor：参数数组启动 `opencode serve`，运行时随机 Basic Auth 密码，健康就绪门禁、版本门禁、异常退出状态和 SIGTERM/SIGKILL 清理。
- 新增常驻 Worker 配置边界；配置中不提供、不保存 Worker 密码。

### TDD Evidence

1. `test/gateway/sse-parser.test.js` 首次运行因模块不存在而失败；实现后覆盖 5 项行为。复核发现消费者抛出的 `SyntaxError` 会被误吞，新增先失败用例后修复。
2. `test/gateway/opencode-client.test.js` 首次运行因模块不存在而失败；实现后覆盖 4 组契约。复核增加“响应头已到达、正文超时”用例，先复现漏控再修复为完整请求期限。
3. `test/gateway/worker-process.test.js` 首次运行因模块不存在而失败；实现后覆盖 7 项行为。复核增加不存在可执行文件用例，先复现 `stopping` 残留再改用 `close` 事件收敛为 `stopped`。
4. `test/config.test.js` 新增 Worker 默认值、显式配置、端口上界、身份字符和无密码字段用例，首次 3 项失败后实现转绿。

### Real OpenCode Smoke

- 本机命令：`/Users/yenini/.opencode/bin/opencode`。
- 已验证版本：`1.18.25`。
- Worker：成功启动于 `http://127.0.0.1:4319`，`/global/health` 返回健康，随后正常停止，端口释放。
- 本次冒烟未发送 Prompt，不调用真实模型，不输出运行密码。

### Review Notes

- Worker 标准输出和错误输出默认不转发，避免第三方运行时把凭证或私人正文带入工作台日志。
- 所有子进程参数通过数组传入且 `shell: false`；浏览器不会获得 Worker Origin 或 Basic Auth 密码。
- Stage 2B 交付的是可复用 Worker 与 Client 边界，尚未替换现有产品聊天链路。

### Verification

- `npm test`：147/147 通过。
- `npm run build`：通过，37 modules transformed。
- `npm run check`：通过，72 files。
- `npm run security:scan`：通过，无发现。
- `git diff --check`：通过。
- 真实 OpenCode Worker 停止后，`127.0.0.1:4319` 无监听进程。
- GitHub：Stage 2B 提交 `44826f6` 已推送到公开仓库 `main`，远端 SHA 与本地一致。

## Stage 2C：双 Worker、粘性 Session 与公平队列

### Delivered

- 按用户轮转的公平队列：同用户 FIFO、用户间 round-robin、单用户排队上限、取消与暂不可运行跳过。
- 默认 2 Worker 的常驻池：Conversation 粘性、容量租约、健康 Worker 选择、心跳摘除与重启、干净停止。
- Gateway Service：持久 Job 入队、受控工作目录、OpenCode Session 创建/复用、消息执行、有序事件、取消与超时。
- 默认全局并发 2、单用户并发 1、单 Conversation 并发 1；同一用户不能占满两个槽位。
- Worker 异常只中断该 Worker 上的 Job，另一个 Worker 继续完成；Worker 密码不进入池快照、数据库或日志。
- 20 用户确定性模拟全部完成，无用户饥饿，全局与用户并发峰值均未越界。

### TDD Evidence

1. `fair-queue`、`worker-pool`、`gateway-service` 首次运行均因模块不存在进入 RED，随后逐模块实现转绿。
2. 集成测试发现 Worker 元数据未先持久化会造成 Session 外键失败；增加状态订阅后修复。
3. 队列溢出回归先复现孤儿幂等 Job，改为容量预检后允许释放容量再用同一幂等键正常提交。
4. Session 创建失败回归先复现 Job 停在 `queued`，改为 Worker 获租即进入 `running` 后正确转为 `failed`。
5. 停止状态、启动时限与组合端口边界测试均先失败，修复后通过。

### Review Notes

- 产品聊天尚未接入本 Gateway；Stage 2C 验收范围是服务端调度与执行底座，用户可见多 Conversation 在 Stage 2D 完成。
- 工作目录只能由服务端以用户和 Conversation 标识派生，并再次经过现有根目录与符号链接安全策略。
- 心跳失败清空的仅是受影响 Worker 租约，其他 Worker 的任务和会话不被取消。

### Verification

- `npm test`：166/166 通过。
- `npm run build`：Vite production build 通过，37 modules transformed。
- `npm run check`：78 个仓库 JavaScript 文件语法检查通过。
- `npm run security:scan`：通过，无发现。
- `git diff --check`：通过。
- GitHub 远端提交证据在 Stage 2C 推送后补录。
