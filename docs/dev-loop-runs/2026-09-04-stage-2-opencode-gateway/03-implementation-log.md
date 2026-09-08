# Stage 2 Implementation Log

## Stage 2E.4：恢复边界禁止静默重放

- 启动恢复先验证旧 OpenCode Session。若不可用，相关持久排队任务从内存公平队列移除并转为 `interrupted / OPENCODE_SESSION_UNAVAILABLE`；没有旧 Session 的新 Conversation 不受影响。
- Job 状态机明确支持 `queued → interrupted`，事件序列保留恢复边界和任务中断，避免把系统中断误记为成员主动取消。
- React 在恢复边界或任务中断时提示“不会自动重放，请确认上下文后重新发送”。
- 采用测试先行：状态机和恢复用例先因缺少语义失败，UI 用例先因缺少提示失败；实现后定向测试通过。架构与安全内联复核结论：宁可要求成员确认，也不在新 Session 中静默执行依赖旧上下文的输入。

## Stage 2E.3：Runtime 多 Session 并发（2026-09-08）

- 用户确认不采用一会话一进程。增加可配置 Runtime 容量，同 Conversation 串行，不同 Session 可同时分配到同 Runtime；配置与正式入口已接通。
- 实测发现原 Worker 客户端将所有 HTTP 请求限制为 1 秒，模型请求误超时；分离健康、Session 和模型请求期限。HTTP 200 内嵌模型错误现在安全返回失败，不将空回复记为成功。
- 增加连续健康失败门限，重启前停止旧进程；健康恢复唤醒粘性排队会话。对应回归先失败后修复。
- 单 Runtime 15 执行槽模拟：45/45 完成，峰值 15，每人峰值 3。真实 OpenCode 1.18.25：同样 45/45，三轮 19257/3265/2551 ms，后续轮次不重复传入方案标识仍正确保留；账号列表只包含本人的 3 个会话，跨账号读取 404。
- 真实使用合成测试材料和 OpenCode `permission: deny`，不包含业务资料；因此该结果不能证明允许任意工具执行时的文件安全隔离。
- 完整回归首次 196/197；WebSocket 全局会话限额用例偶发 HTTP 200，相关 15 项单独复跑通过，未复现。完整回归重跑结果见验收报告。
- 夜间自动化实际以 UTC 解释小时，09:00 北京时间才触发；已向用户报告时区偏差并暂停剩余错时触发，未使用重置卡。

## Stage 2E.2b：可视化运行管理

- 管理员账号页接入健康指标、Worker 占用、任务元数据、刷新和页面内二次确认取消。刷新失败保留旧数据并明确提示过期；不显示私人内容。
- 组件 RED→GREEN；浏览器在隔离 Demo 注入测试排队任务，验证保留任务、确认取消、刷新后已取消与私人正文不可见。桌面 1440×1100、窄屏 390×844 无横向溢出，截图 `artifacts/screenshots/stage-2e-admin-*.png`。
- 原生确认弹窗导致浏览器工具阻塞，替换为页面内确认并重新完整验证；没有以模拟确认替代实际点击。
- 新增用户验收要求：5 人 × 3 会话 × 至少 3 轮方案沟通，后续分别验收模拟与真实 OpenCode。

## Stage 2E.2a：管理员运维 API（2026-09-07）

- 基于 `21c990e` 继续未提交的接口实现；未改动用户无关文件。按既有授权串行开发、内联复核，不派发子代理。
- 提供 `/api/admin/gateway/health`、`workers`、`jobs` 和 `jobs/:id/cancel`。任务查询限定最近 200 条元数据；管理员不读取私人标题、正文和幂等键，Worker 使用白名单字段。
- 复用登录、管理员角色、CSRF 和审计链路。取消调用真实任务所有者执行，但审计记录实际管理员。
- 定向 RED 发现健康接口读取三次快照、上游错误透出风险；修正为一次快照与固定脱敏错误。测试审计表名已按真实 schema 修正。
- 定向测试 4/4：权限和隐私、健康降级、缺失任务与失败脱敏、真实 Gateway 排队取消及重复取消。此子阶段不修改前端，浏览器验收留在页面交付点。

## Stage 2E.1：启动恢复

- 正式启动先对持久任务进行核对，再启动 Worker 并验证旧 Session，最后开放调度。
- 排队任务按创建顺序重新入队；未知结果的 running 任务标为 interrupted，终态保留，恢复过程不调用 Prompt 重放。
- 旧 Session 恢复失败时保留历史并追加恢复边界，新任务可创建新 Session。
- 队列容量不足、Worker 启动失败时清空临时队列，允许再次从持久数据恢复。
- TDD：生产启动最初没有执行已持久化排队任务；恢复失败重试最初遗留一个队列条目。增加回归、复现失败并修复后定向 15/15 通过。
- 本次为启动恢复子阶段，运维后台、运行期间 Worker 恢复和真实 Provider 验收待后续实施。

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

- GitHub：Stage 2C 主提交 `5664786` 已推送到公开仓库 `main`，远端 SHA 与本地一致。

## Stage 2D.1：私人 Conversation 产品 API

### Delivered

- 成员可创建、列出、读取、重命名和逻辑归档自己的 Conversation。
- 所有写请求继续使用现有登录与 CSRF 门禁；成员无法读取、修改或归档其他成员 Conversation。
- 管理员只能读取 Conversation 的运行元数据，不返回私人标题或正文。
- 创建、重命名和归档动作写入账号归属审计，审计元数据不保存私人标题。
- 已归档 Conversation 不再接受新 Gateway Job，避免后台继续执行不可见会话。

### TDD Evidence

1. `test/api/conversations.test.js` 首次 4/4 失败并落到未实现路由；实现 Store 与路由后 4/4 通过。
2. 代码复核增加“归档后不能创建 Job”用例，首次复现可继续入队，收紧 Store 后转绿。

### Boundary

- 本子阶段只完成 REST 产品对象；WebSocket 事件续传与前端 Conversation 界面仍属于 Stage 2D 后续工作。

### Verification

- Conversation/API 定向验收：20/20 通过。
- `npm test`：171/171 通过。
- `npm run build`：通过，37 modules transformed。
- `npm run check`：80 个仓库 JavaScript 文件语法检查通过。
- `npm run security:scan`：通过，无发现。
- `git diff --check`：通过。

## Stage 2D.2：可续传 Gateway WebSocket

### Delivered

- 新增 Gateway WebSocket 协议模块，支持 `subscribe`、`prompt` 和 `cancel`，并沿用 Stage 2A 的持久事件 envelope。
- 断线重连可按 `afterSequence` 补发缺失事件；超前游标或超过 1000 条的回放缺口返回带 `recoveryBoundary` 的一致快照，避免无界回放。
- Prompt 使用用户范围幂等键；重复请求返回同一 Job 且不重复产生排队事件。
- WebSocket 每条消息重新校验登录 Session，取消操作同时校验用户与 Conversation；断开连接只移除订阅，不取消持久 Job。
- WebSocket 单帧限制为 512KB，超限连接以 `1009` 关闭，避免业务校验前解析超大 JSON。
- 新增带 CSRF 的 REST 取消入口；成员不能探测或取消其他成员 Job，也不能借用错误 Conversation 路径取消自己的 Job。
- 保留旧 Demo/产品聊天协议；只有组合了 Gateway Service 的服务器实例才启用新协议，React 与生产入口切换留在 Stage 2D 后续子阶段。

### TDD Evidence

1. 新 WebSocket 契约首次运行 0/2，失败原因为服务器未注入 Gateway 且只接受旧 `input` 协议；加入 REST 与登录撤销场景后 0/4。
2. 实现协议模块、服务器注入和取消接口后转为 4/4；旧 WebSocket 与 Gateway 定向回归同步通过。
3. 内联代码复核发现 1000 条事件上限会误判最新序号；新增超大缺口用例首次 9/10，增加持久事件高水位与恢复边界后 10/10。
4. 安全复核新增超大 WebSocket 帧用例，首次因连接未关闭进入 RED；配置 512KB 上限并安全处理连接错误后转绿。

### Verification Snapshot

- Gateway/WebSocket 定向回归：30/30 通过。
- `npm test`：178/178 通过。
- `npm run build`：通过，37 modules transformed。
- `npm run check`：82 个仓库 JavaScript 文件语法检查通过。
- `npm run security:scan`：通过，无发现。
- `git diff --check`：通过。

### Boundary

- 本子阶段完成服务端实时协议，不代表成员界面已经使用常驻 Gateway；生产 Gateway 组合、React 多 Conversation 状态管理与浏览器验收仍未完成。

## Stage 2D.3：生产 Gateway 组合与 React 多会话体验

### Delivered

- 正式启动入口组合公平队列、默认双 Worker 池与 Gateway Service；启动时先拉起 Gateway，停止时先中断 Gateway 任务并停止 Worker，再关闭 WebSocket、HTTP 与数据库。
- React AI 平台支持私人 Conversation 列表、新建、切换、历史重建，以及排队、运行、完成、停止、中断、失败和重连状态。
- 浏览器按持久事件序号去重和续传；刷新后从服务端恢复问题、回答与任务状态，不使用 `localStorage` 或 `sessionStorage` 保存私人对话。
- 用户输入作为 `message.created` 与 Job 在同一事务持久化，确保完整历史可由 Gateway 事件重建。
- 无密钥 Demo 改走与生产一致的 `gateway.v1`、Conversation REST 和双 Worker 组合，只在 Worker 执行边界注入明确标注的本地模拟回复。
- 桌面和窄屏重新布局 Conversation、消息区和方案沉淀区，修复旧聊天 Grid 规则造成的状态栏错位、输入区异常拉伸和按钮换行。

### TDD and Debugging Evidence

1. 生产组合测试先因未启动 Gateway Worker 进入 RED；组合 Worker Pool、Gateway Service 与服务器生命周期后转绿，并确认默认两个 Worker 都完成启动和停止。
2. Demo 契约从旧 `input/response` 改为 `gateway.v1`、Conversation、`subscribe/prompt` 和 `message.delta`，先失败后实现转绿。
3. UI 契约增加私人 Conversation 导航、运行控制与持久事件 reducer；定向回归 28/28 通过。
4. 浏览器截图发现 `.chat` 继承旧 `grid-template-rows: 1fr auto`，固定四行修正又会被可选恢复提示改变子节点顺序，导致输入区占满剩余高度；以一次性浏览器断言复现 `composerHeight=532` 后改为纵向 Flex，复验为 `composerHeight=81`、消息区填充剩余空间。
5. 第二轮视觉复核发现“发送”被压成两行；浏览器文本 Range 先复现 `lineRects=2`，增加最小宽度和不换行约束后桌面、窄屏均为 `lineRects=1`。
6. 真实 `npm run demo` 的 Ctrl-C 验收发现端口虽释放但临时目录残留；新增 POSIX 进程组回归先失败。进程树确认 npm 与 Demo 同属前台组，终端与 npm 会重复转发信号；改为持续安装幂等清理处理器后 3/3 Demo 生命周期用例通过。

### Review Notes

- WebSocket 重连闭包只保留一个指数退避计时器；同 Conversation 重复订阅会先取消旧订阅，切换后的其他 Conversation 订阅只更新各自隔离状态。
- Gateway 事件读取和取消均带所有者校验；管理员 Conversation 接口只返回运行元数据，不返回标题、消息或 Job 输入。
- Worker 仍只监听回环地址，随机 Basic Auth 密码不进入前端、数据库、日志或 Demo 文档。
- Stage 2E 的 Gateway 重启队列重建、运维后台和真实内部模型多轮联调仍未完成，本阶段不宣称 Linux 生产可用。

### Browser Acceptance

- 无密钥 Demo：`gateway.v1` 创建 Conversation、提交 Prompt、收到 `message.delta`，刷新后重新进入 AI 平台可恢复完整问答与“已完成”状态。
- 双账号：管理员的私人 Conversation 不出现在普通成员账号；普通成员没有账号管理入口。
- 1440×900 与 390×844 均无横向溢出，浏览器 Console Error 为空；`localStorage` 与 `sessionStorage` 条目均为 0。
- 截图：`artifacts/screenshots/stage-2d3-conversations-desktop.png`、`artifacts/screenshots/stage-2d3-conversations-mobile.png`。

### Verification Snapshot

- `npm test`：182/182 通过。
- `npm run build`：通过，39 modules transformed。
