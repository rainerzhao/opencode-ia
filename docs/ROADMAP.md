# OpenCode 团队 AI 工作台研发路线图

更新时间：2026-09-13

## 当前结论

项目当前处于 **Stage 0–4 已完成 Mac 应用级验收；MySQL 单一数据层已完成代码级装配、真实 MySQL HTTP/WebSocket 冒烟和恢复演练；Stage 5A–5C 已完成部署前置能力，Stage 5D–5E 必须在公司 Linux 预发布机继续验收** 的状态。

Mac 上已经跑通 React 前后端、账号权限、默认私有数据边界、常驻 Gateway 多 Session、React 多 Conversation、运行管理、真实多人多轮模型联调、Runtime 崩溃恢复、OpenCode 标准工具面的应用级隔离、私人 Skill 草稿、受控文件包、结构与安全报告、人工发布、按账号安装/启用、版本升级/回滚、停用/归档、真实 OpenCode 发现门禁和无密钥 Demo。Linux OS 沙箱与生产部署不属于本结论。

## 阶段总览

| 阶段 | 状态 | 核心目标 | 阶段出口 |
| --- | --- | --- | --- |
| Stage 0 安全基线 | ✅ 完成 | 让原型可测试、可演示、可公开协作 | 自动测试、密钥扫描、浏览器验收通过 |
| Stage 1 产品底座 | ✅ 完成 | React/Vite、账号密码、SQLite、角色与审计 | 多用户身份清晰、数据可追踪、默认私有 |
| Stage 2 OpenCode Gateway | ✅ Mac 验收完成 | 常驻 OpenCode 服务、会话映射、公平调度 | 不再每条消息冷启动，多人多会话可控 |
| Stage 3 知识与方案 | ✅ Mac 验收完成 | 检索、版本、私有到发布流程、来源追溯、附件和恢复 | 知识可查、可审、可撤回、可追溯、可恢复 |
| Stage 4 Skill 中心 | ✅ Mac 验收完成 | 草稿、校验、发布、安装、启用、版本、回滚、停用、归档 | 成员能安全生产并共享 Skill |
| Stage 5 Linux 生产化 | 🚧 5A 配置门禁、5B 可观测性、5C Provider 联调门禁完成 | 内网部署、内部模型、备份、监控、压测 | 真实环境达到上线检查表要求 |

## Stage 0：安全可演示基线

已完成：

- 可移植配置和路径根；
- 参数化 OpenCode 子进程、超时、取消、输出限制和强制清理；
- HTTP/WebSocket 生命周期和并发限制；
- 文件路径、符号链接、上传暂存与失败回滚；
- URL 白名单、DNS 地址检查、重定向、超时和大小限制；
- 标准测试、语法检查、密钥扫描和公开 README；
- Mac 桌面与手机浏览器验收；
- 无密钥、临时数据隔离的 `npm run demo`。

明确未完成：账号体系、SQLite、持久会话、正式审计、Skill 发布和 Linux 上线。

## Stage 1：产品底座

目标：把“技术演示”变成“可持续开发的多用户产品”。

主要工作：

1. 前端迁移到 React + Vite，建立路由、状态、API 客户端和组件边界。
2. SQLite WAL 数据层和迁移机制。
3. 本地用户名/密码；管理员创建账号，不开放自注册。
4. `admin/member` 角色、Session 撤销、密码重置和账号停用。
5. 操作日志绑定登录用户；不以 IP 作为身份。
6. 对话、知识草稿和方案默认私有，显式确认后才能发布。

分阶段交付进度：

- ✅ Stage 1A：SQLite WAL、版本化迁移、用户/Session/审计仓储、首位管理员 CLI。
- ✅ Stage 1B：登录、退出、当前用户、Cookie、CSRF、限速、账号管理和 Session 撤销。
- ✅ Stage 1C：REST/WebSocket 权限、默认私有边界、写操作审计、WebSocket Origin/撤销校验。
- ✅ Stage 1D：前端登录、认证请求、服务端私有方案、账号管理、角色界面和桌面/手机浏览器验收。
- ✅ Stage 1E：React/Vite 迁移、Demo 更新和 Stage 1 总验收。

Stage 1 已在 Mac 上跑通管理员与成员浏览器闭环、React/Vite 迁移、资源本地打包和无密钥 Demo。它提供产品底座，但尚不能作为内网生产系统开放。

出口标准：账号和权限测试通过；成员默认看不到彼此私有内容；管理和发布动作有审计；Mac 端到端验收通过。

## Stage 2：OpenCode Gateway

目标：让 OpenCode 从“每消息启动一个进程”变成可管理的常驻服务。

主要工作：一个常驻 Gateway 管理 2 个起步、可扩到 2–4 个的常驻 OpenCode Worker；每个 Worker 承载多个逻辑 Session；使用 `Conversation → OpenCode Session → Worker` 粘性映射；统一流式事件、取消和恢复；管理员维护授权模型；按用户公平排队，并实施全局、单用户和单 Session 并发限制；完成健康检查和故障隔离。

首版是单机架构，任务与映射用 SQLite WAL 持久化，不按用户固定进程，也不引入 Redis 或 Kubernetes。详见 [Stage 2 Gateway 架构](architecture/stage-2-opencode-gateway.md)。

分阶段交付进度：

- ✅ Stage 2A：Gateway SQLite Schema、任务状态机、私有 Conversation/Job Store、幂等提交、事件序号和启动恢复语义。
- ✅ Stage 2B：单个受保护的常驻 OpenCode Worker、HTTP/SSE 客户端、进程生命周期和本机真实 OpenCode 健康冒烟。
- ✅ Stage 2C：2 Worker 池、粘性 Session、健康检查、按用户公平队列、并发限制和故障隔离。
- ✅ Stage 2D：私人 Conversation API、WebSocket 订阅/提交/取消、断线补发和恢复边界、生产双 Worker 组合及 React 多会话体验。
- ✅ Stage 2E：启动与运行期恢复、管理后台、20 用户模拟、真实 5×3×3 多会话和工具执行隔离。

Stage 2E 已完成排队重建、未知运行任务中断、Session 检查、恢复失败后的安全边界、管理员运行视图、真实 5 账号/15 Session/45 请求，以及真实 Runtime 强制终止、自动重启和上下文恢复。每个 Conversation 的目录和产物相互隔离；Runtime 以 pure 模式运行，并从全局、Agent 和 Prompt 三层关闭高风险工具。Stage 2 在 Mac 的应用级验收已经关闭。

出口标准：真实 OpenCode 在 Mac 完成多账号、多 Session、排队、恢复和应用级工具隔离验证。内部 Provider 与 Linux 进程级隔离在 Stage 5 验收。

## Stage 3：知识与方案闭环

目标：让个人经验经过人工确认后成为可复用团队资产。

主要工作：SQLite FTS5；草稿、审核、发布、撤回和版本；对话转知识时明确确认；文件与结构化数据一致性；导入导出和备份恢复。

分阶段交付进度：

- ✅ Stage 3A：知识/方案资产与不可变版本数据模型、当前版本 FTS5、默认私有可见性、来源引用 ID 和仓储层隔离测试。
- ✅ Stage 3B：版本化知识/方案 REST 与 React 草稿编辑、页面内二次确认发布/撤回、审计和浏览器验收。
- ✅ Stage 3C：对话沉淀为方案、方案转知识、引用展示与来源追溯核心链路；Legacy Adapter 已拆分，MySQL 真库仍待验收。
- ✅ Stage 3D：完成 Knowledge 版本私有附件、摘要校验、下载、安全预览、知识包导入导出、版本差异、SQLite/MySQL 备份恢复、历史版本恢复和旧方案文件接口退役；知识与方案恢复都会复制历史正文及来源为新的不可变当前版本，Knowledge 同时继承对应附件。

Stage 3 已在 Mac 上形成内容资产闭环：只索引当前知识版本，私人草稿不会因误设团队可见性而对成员暴露；成员可将已完成对话人工沉淀为私有方案，再转为私有知识草稿；来源卡按所有权裁剪，发布不会反向公开私人 Conversation。附件、预览、受控导入导出、版本差异、备份恢复和历史版本恢复均已通过 SQLite、真实 MySQL 及浏览器验收。该结论不替代 Linux 预发布和生产灾备验收。

出口标准：所有公开内容可定位作者、来源、版本和发布时间，并能回滚。

## Stage 4：团队 Skill 中心

目标：普通成员能够开发 Skill，并安全地共享给团队。

主要工作：结构和安全规则校验；自动测试报告；成员自助发布、安装和启用；版本、回滚、禁用、归档和审计。

分阶段交付进度：

- ✅ Stage 4A：SQLite Skill/版本/安装数据模型，默认私有草稿，成员创建、编辑和归档，管理员治理，React 浏览器体验。
- ✅ Stage 4B：frontmatter、目录、文件、敏感信息、路径和危险命令校验，持久化报告与受限 OpenCode 运行验收。
- ✅ Stage 4C：人工发布、成员安装与启用、原子落盘和 OpenCode 发现验证。
- ✅ Stage 4D：新版本、升级、回滚、停用、归档和跨账号完整验收。

Stage 4 已完成 Mac 应用级验收。私人草稿只对创建者和治理管理员可见，团队可见性不能暴露 draft/archived 内容；列表按调用者解析当前公开版本，绝不以最新私有草稿替换团队版本。校验支持受控多文件包，报告不复制疑似秘密原文，静态检查与真实 OpenCode 受限加载必须同时通过；内容变化会使旧报告失效，过期异步结果不能覆盖新版本。发布、安装和启用是三个人工动作：不可变包原子写入每用户受管目录，启用前必须通过 OpenCode 发现验证，随后才在该账号 Conversation 工作区物化；不会自动全员启用或按用户绑定独占 Runtime。4D 保留历史发布版本，升级/回滚重置为已安装并强制重新验证；版本集变化会重绑新受管工作区和 OpenCode Session，避免常驻 Runtime 缓存旧 Skill。停用立即撤销 enabled 状态，归档保留版本与审计而不做永久删除。

MySQL 迁移 Phase A/B 已完成代码级装配：Skill、内容、Gateway、账号、审计和登录均接入同一异步 MySQL Repository，并在隔离 MySQL 8.4 上通过分域生命周期回归、生产组合启动能力检查以及 HTTP/WebSocket 组合冒烟（模拟 Worker）；内部 Provider、真实 OpenCode 全链路、Linux 部署和生产切换仍未完成。

出口标准：创建、校验、发布、安装、使用到回滚的完整流程通过端到端验收。

## Stage 5：Linux 内网生产化

目标：迁移到公司内网单台 Linux 服务器，服务约 15–20 名成员。

主要工作：非 root 服务账号；Nginx HTTPS 与 WebSocket；内部兼容 OpenAI 协议模型；备份恢复；日志和监控；容量、重启恢复和故障演练。

已加入预发布配置模板：`deploy/Dockerfile`、连接公司云 MySQL 的 `deploy/compose.intranet.yaml`、systemd 单元、Nginx WebSocket 代理、`/healthz` 探活，以及带摘要清单和显式确认的 MySQL 备份/恢复命令。生产 Compose 只运行工作台，不承担数据库实例、高可用或自动备份。Stage 5A 新增 `npm run preflight:production`，启动前拒绝 root、SQLite 混用、非 Secure Cookie、无效 OpenCode 可执行文件和超出 Worker 池容量的并发配置；Stage 5B 新增聚合 `/metrics`；Stage 5C 新增 `npm run preflight:opencode` 和 [内部 Provider 联调清单](operations/internal-provider.md)。Stage 5D1 已把两项门禁接入 Docker/systemd 受检启动器，生产服务在门禁失败时不会打开端口，并为 Docker build context 排除本机配置、数据库、Git 与交接材料。模板、门禁和指标不包含凭证或证书，尚未在公司 Linux 预发布机执行启动、升级、回滚和故障演练。

剩余交付分为两个阶段：

Stage 5D 的首次部署入口已补齐：管理员 CLI 使用与生产服务相同的云 MySQL，运行能力检查、迁移和带锁的首次初始化。Mac 真库已验证并发初始化只产生一个管理员及审计记录，并由 CLI 创建的账号跑通生产组合 HTTP 登录与会话。云数据库 TLS 已接入主机名和 CA 校验、只读 CA 挂载及加密备份恢复；本地证书验收记录见 `docs/dev-loop-runs/2026-09-13-cloud-mysql-tls/`。公司云数据库实际证书/网络、Linux 镜像和公司环境联调仍待完成。

- 🚧 Stage 5D：在公司 Linux 预发布机以非 root 账号部署 Nginx、OpenCode 常驻 Runtime 和工作台，连接公司云 MySQL，接入真实内部 OpenAI 兼容 Provider，跑通登录、多会话、Skill、知识与审计全链路。
- ⏳ Stage 5E：完成 15–20 用户容量、长时间运行、Runtime/MySQL/进程故障、备份恢复、升级回滚、安全检查与上线清单，由人工确认残余风险后再开放访问。

出口标准：生产检查表全部通过，残余风险和回滚方案由人工确认后再开放访问。

## 数据层迁移：MySQL 8.4 单一事实源

已决定以 MySQL 8.4 作为生产单一事实源：Mac 开发与验收使用本机 Docker MySQL 8.4，公司 Linux 环境连接同主版本的公司云 MySQL；生产应用 Compose 不自建数据库，无密钥 Demo 仍可使用隔离 SQLite。账号、登录 Session、审计、Gateway、知识、方案与 Skill 均已接入 MySQL-only 生产组合，并在 Mac 真库完成 HTTP/WebSocket、迁移、检索和恢复回归。该证据只证明应用组合可迁移，云数据库网络/TLS、Linux 实际切换、容量和灾备仍属于 Stage 5D–5E。

## 不变的边界

- 工作台不直连模型 API，所有推理和 Skill 执行经过 OpenCode。
- Provider 密钥不进入前端、仓库、工作台数据库或日志。
- 用户身份来自账号登录，不来自办公电脑 IP。
- 内容默认私有，发布必须由人确认。
- AI 辅助处理和生成，人负责准确性、风险和最终交付。
