# Stage 2 OpenCode Gateway Requirements Baseline

## Goal

在 Mac 上把当前“每条消息启动一次 `opencode run`”升级为一个可管理的常驻 Gateway：默认管理 2 个仅监听回环地址的 OpenCode Worker，持久化 Conversation、OpenCode Session、Job、Worker 和事件状态，为 15–20 名成员提供多会话、按用户公平排队、取消、重连补发、重启恢复和故障隔离。

## Non-goals

- 本阶段不开发团队 Skill 创建、校验、发布、安装和回滚；它在 Stage 2 验收后作为独立 Stage 4 子项目设计与实施。
- 本阶段不开发知识与方案的审核发布、FTS5 和版本闭环。
- 本阶段不迁移 Linux、不接入公司 SSO、不引入 Redis、Kubernetes 或 PostgreSQL。
- 本阶段不让工作台保存、展示或代理 Provider API Key。
- 本阶段不自动重放可能产生外部副作用的中断任务。

## User-visible Behavior

- 每个成员可以创建多个私人 Conversation，并连续进行多轮对话。
- 多名成员可以同时提交任务；同一 Conversation 严格串行，不同 Conversation 可由不同 Worker 并行处理。
- 等待中的任务显示排队状态；单个成员不能占满所有执行槽位。
- 用户可以停止自己的运行任务，并在断线重连后恢复任务状态与缺失事件。
- OpenCode Worker 异常时，其他健康 Worker 继续服务；受影响任务显示真实的中断或恢复边界。
- 管理员可以查看 Worker、队列和任务元数据，但默认不能查看成员私人对话正文。

## Acceptance Criteria

1. 应用启动后默认管理 2 个 `opencode serve` Worker；Worker 只监听 `127.0.0.1`，使用运行时随机 Basic Auth 密码，浏览器不能直连。
2. 工作台通过 OpenCode 1.18.25 已验证的 HTTP/SSE 接口创建 Session、发送消息、订阅事件和停止任务，不再为每条消息冷启动完整 OpenCode 环境。
3. SQLite 版本化迁移持久化 `conversations`、`opencode_sessions`、`gateway_jobs`、`gateway_workers` 和 `gateway_events`，并保持现有用户、登录 Session 和审计数据兼容。
4. 调度默认全局运行上限 2、单用户运行上限 1、单用户排队上限 3、单 Session 运行上限 1；排队按用户轮转，同一用户内部 FIFO。
5. 所有创建、读取、取消和重试操作校验登录身份与资源所有权；管理员默认只能读取运行元数据。
6. Worker 心跳失败后停止接单，当前任务标记为 `interrupted`；Gateway 重启不会把未知结果的运行任务误报为成功。
7. WebSocket 事件具有 Conversation、Job 和递增序号；客户端携带最后序号重连时可补发缺失事件或读取一致快照。
8. 自动化测试覆盖状态机、持久化、公平调度、并发上限、身份隔离、取消、超时、断线、Worker 失败和 Gateway 重启。
9. Mac 上用模拟 Worker 完成 20 用户并发验收，并以显式开关运行真实 OpenCode 1.18.25 冒烟测试；普通测试不调用真实模型。
10. 每个 2A–2E 阶段完成后更新 README 和路线图，执行完整验证，创建中文提交，推送 GitHub `main` 并核对远端 SHA。

## Constraints

- OpenCode 始终是模型、Agent、Skill 和工具的唯一执行引擎；工作台不直连模型 API。
- 开发与首轮验收环境为 macOS、Node.js 24；Linux 只允许通过配置替换运行环境，不改变工作台业务协议。
- 每个 Conversation 使用受控工作目录；不得接受浏览器提供任意宿主机路径。
- 日志和审计不得记录密码、Cookie、Token、Basic Auth 密码、Provider Key 或默认完整私人正文。
- 新行为采用测试先行；每个阶段必须保持应用可启动、可回滚，并兼容无密钥 Demo。

## Assumptions

- 首版直接调用 `opencode serve` 的 HTTP/SSE API，不再用 `opencode run --attach` 作为主要执行链路。
- 当前最低验证版本固定为 OpenCode `1.18.25`；启动时通过 `/global/health` 核对版本和健康状态，版本漂移必须显式暴露。
- Worker 运行密码只保存在父进程内存与子进程环境中，不写入数据库、文件或日志。
- 当前用户已授权每个可验收阶段验证后提交并推送公开仓库 `main`。
- 当前执行规则不允许主动派发子代理，因此计划与验收采用当前任务内的多视角复核。

## Open Questions

没有阻塞 Stage 2A 的开放问题。Linux 服务账号、内部 Provider 地址和最终 Worker 数在 Stage 5 的真实环境中确认。

## Source Request

用户要求建立 Goal，分阶段开发多人常驻对话与团队 Skill 中心；每个工作阶段完成后更新 README 并上传 GitHub。

## Repo Context

- Repo: `https://github.com/rainerzhao/opencode-ia`
- Branch: `main`
- Base SHA: `5db4d871f18336742cfeafddc34eb55ee38956f9`
- Starting state: clean and aligned with `origin/main`
- Approved design: `docs/architecture/stage-2-opencode-gateway.md`
- Local OpenCode evidence: `opencode --version` 返回 `1.18.25`；`opencode serve` 提供 `/global/health`、`/event`、`/session`、`/session/{sessionID}/message` 和 `/session/{sessionID}/abort`。
