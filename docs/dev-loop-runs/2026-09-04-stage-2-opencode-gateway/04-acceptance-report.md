# Stage 2 Acceptance Report

## Stage 2E.6 真实 Runtime 崩溃恢复演练

**PASS WITH NOTES**：opt-in 验收建立真实会话上下文后强制终止测试自行启动的 OpenCode Runtime。运行任务转为 interrupted，Runtime 以新 PID 自动恢复，原 Session 验证成功后排队任务继续完成并保留第一轮上下文标识。测试使用合成内容和 `permission: deny`；工具、文件与产物隔离以及 Linux 长时稳定性仍未覆盖，Stage 2E 尚不关闭。

真实命令：`npm run test:runtime-crash`；结果 1/1 通过。失败门禁另以无效可执行文件确认 Runtime 无法启动时测试会失败。

完整回归：202 项通过、1 项 opt-in 测试默认跳过、0 失败；构建 40 modules；语法检查 89 files；密钥扫描及 `git diff --check` 通过。

## Stage 2E.5 运行期确定性恢复

**PASS WITH NOTES**：Runtime 异常后会话进入 recovering，原 Session 校验通过才继续排队工作；Session 消失时任务被安全中断。恢复流程的同步回调重入竞态已由失败测试复现并修复。Store 与 Gateway 定向 20/20 通过。真实 OpenCode 子进程 kill/restart 和上下文连续性已由 Stage 2E.6 补充验证。

完整验证：`npm test` 202/202；构建 40 modules；语法检查 88 files；密钥扫描及 `git diff --check` 通过。

## Stage 2E.4 恢复安全增量

**PASS WITH NOTES**：结果未知的运行任务仍不重放；旧 Session 不可用时，其排队任务也转为中断并退出内存队列。新 Conversation 的首个任务保持排队，可在新 Session 正常执行。UI 明确要求确认上下文后重新发送。该增量覆盖启动恢复，不代表运行期间进程崩溃的完整恢复演练已经完成。

验证：定向状态机、恢复、生产组合和 React 用例通过；全量 `npm test` 199/199，通过；构建 40 modules、语法检查 88 files、密钥扫描和 `git diff --check` 均通过。

## 2026-09-08 Runtime 并发验收增量

**PASS WITH NOTES**：单常驻 OpenCode 1.18.25 Runtime、5 账号、15 Session、3 轮 45 请求真实链路通过，峰值 15 个运行任务、每人 3 个。每轮检查方案标识保留、其他会话标识不存在，以及账号列表和越权 REST。耗时 19257/3265/2551 ms，为一次 Mac 合成短测，不是 SLA。

边界：工具被禁止；完整文件沙箱、Linux 资源压测、运行期间 Session 丢失处理以及长时稳定性仍未验收。Stage 2E 不宣告整阶段完成。新增 Runtime 多槽、健康失败门限、模型错误处理和恢复唤醒回归覆盖；代码复核在主线程内联完成，未派发子代理。

完整回归重跑 197/197 通过；构建 40 modules、语法检查 88 files、密钥扫描无发现、`git diff --check` 通过。首次偶发 WebSocket 失败及复跑过程保留在实现日志中，根因未确认。

## Overall Verdict

### Stage 2E.2a 运维 API

API 定向验收 4/4 通过；内联复核覆盖权限、隐私、审计、取消语义、查询边界及失败响应。发现的快照不一致和上游错误泄漏均已修复。管理员只获得运行元数据，不能读取私人内容。无前端行为变更，本次不声明可视化运维后台完成。完整 Stage 2E、真实模型和 Linux 验收仍待完成。

- `npm test`：190/190，通过，无跳过。
- `npm run build`：通过，39 modules。
- `npm run check`：通过，87 files。
- `npm run security:scan`：通过，无发现。
- `git diff --check`：通过。

**PASS WITH NOTES** — Stage 2A–2D 已在 Mac 通过验收，常驻双 Worker Gateway 已接入 React 多 Conversation 产品链路；Stage 2E 和 Linux 生产验收尚未完成。

## Stage 2A Verdict

**PASS**

## Stage 2B Verdict

**PASS**

## Stage 2C Verdict

**PASS**

## Stage 2D Verdict

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
- Gateway WebSocket 的订阅、幂等提交、事件顺序、断线补发、恢复边界、取消所有权和登录撤销。
- REST 取消的 CSRF、用户所有权与 Conversation 路径一致性。
- 生产入口先启动 Gateway/双 Worker、停止时先关 Gateway 再关闭服务器与数据库。
- React 私人 Conversation 新建、切换、排队/运行/完成/中断状态、停止任务和刷新后历史恢复。
- 无密钥 Demo 使用真实 `gateway.v1` 产品链路；桌面、窄屏和双账号隐私隔离浏览器验收。

## Reviewers Run

- Requirements acceptance：Stage 2A–2D 的持久状态、受保护 Worker、双 Worker 调度、公平队列、限流、故障隔离和多会话产品链路均有实现与测试证据。
- Test coverage：新行为经过 RED → GREEN；当前完整回归 182/182 通过，并包含 20 用户确定性模拟、WebSocket 断线补发、恢复边界、超大帧拒绝、生产组合生命周期和 npm 中断清理。
- Code quality：Store、进程监管、OpenCode Client、Worker Pool、公平队列和 Gateway Service 职责分离；内联复核发现的问题均先补回归再修复。
- Security：私人 Job 输入不进入管理员接口；Worker 密码没有数据库字段；工作目录由服务端派生并经过既有安全路径策略。
- Frontend UX：1440×900 与 390×844 浏览器验收无横向溢出，状态栏与消息区顺序正确，刷新后历史恢复，Console Error 为空。
- Docs/migration：README、路线图和架构状态明确区分已完成的 Stage 2D Mac 产品链路与尚未完成的 Stage 2E/Linux 生产条件。

## Tests Run

- `node --test --test-concurrency=1 test/db/gateway-database.test.js`：3/3。
- `node --test --test-concurrency=1 test/gateway/job-state.test.js`：3/3。
- `node --test --test-concurrency=1 test/gateway/gateway-store.test.js`：5/5。
- `node --test --test-concurrency=1 test/gateway/sse-parser.test.js`：5/5。
- `node --test --test-concurrency=1 test/gateway/opencode-client.test.js`：4/4。
- `node --test --test-concurrency=1 test/gateway/worker-process.test.js`：7/7。
- Stage 2C 定向测试：32/32。
- Gateway/WebSocket 定向测试：30/30。
- Stage 2D.3 定向测试：28/28。
- `npm test`：182/182。
- `npm run build`：通过，39 modules transformed。
- `npm run check`：通过，83 files。
- `npm run security:scan`：通过，无发现。
- `git diff --check`：通过。

## Requirement Coverage

- Stage 2A：通过。
- Stage 2B 单 Worker：通过。
- Stage 2C Worker 池与队列：通过。
- Stage 2D 多会话产品链路：通过；Conversation API、可续传协议、生产双 Worker 组合、React UI 和浏览器验收均完成。
- Stage 2E.1 启动恢复：通过；定向 15/15、全量 186/186、构建、85 文件语法检查和密钥扫描通过。整阶段运维与真实模型验收待完成。

## Findings and Fixes

- 完整回归首次发现旧数据库测试固定假设只有 migration 1；已改为验证所有已知 migration 只执行一次。
- `git diff --check` 首次发现一处新增行尾空格；已修正并复验。
- 代码复核发现 Conversation 标题原本会接受换行控制字符；增加先失败的回归测试后收紧校验，同时保留 Job 正文的多行输入。
- Stage 2C 集成测试发现 Worker 元数据持久化、队列溢出孤儿 Job、Session 初始化失败状态和停止状态同步问题；均增加 RED 用例后修复。
- Stage 2D.2 复核发现超过 1000 条的事件缺口会误判最新序号；增加高水位查询与恢复边界用例后修复。
- Stage 2D.2 安全复核发现 WebSocket 默认帧上限过大；增加 512KB 连接级限制和 `1009` 关闭回归。
- Stage 2D.3 浏览器复核发现旧聊天 Grid 把状态栏拉到消息区中部，固定行修正又使可选恢复提示缺席时输入区异常拉伸；改为纵向 Flex 后，消息区填充剩余空间、输入区恢复自然高度。第二轮修正发送按钮换行，并在桌面与窄屏重新截图验证。
- Stage 2D.3 停机复核发现 `npm run demo` 接收终端中断时可能重复转发信号并在异步清理前退出；保留幂等信号处理器并先同步移除隔离目录，新增真实 npm 进程组回归后转绿。

## Residual Risks

- Stage 2E 运维后台、运行期间 Worker 恢复演练和真实内部模型多轮联调尚未完成。
- 当前只在 Mac 和本地模拟回复完成产品验收；Linux、Nginx、内部 Provider、备份恢复、容量压测和生产回滚演练仍是上线前门禁。
