# OpenCode 团队 AI 工作台研发路线图

更新时间：2026-09-04

## 当前结论

项目当前处于 **Stage 0、Stage 1 完成，Stage 2A–2B 完成，Stage 2C 待开发** 的状态。

Mac 上已经跑通 React 前后端、账号权限、默认私有数据边界和无密钥 Demo。Stage 2B 已验证一个受保护的常驻 OpenCode Worker 及 HTTP/SSE 客户端，但产品聊天尚未切换到 Worker 池，因此仍不代表公司内网生产可用。

## 阶段总览

| 阶段 | 状态 | 核心目标 | 阶段出口 |
| --- | --- | --- | --- |
| Stage 0 安全基线 | ✅ 完成 | 让原型可测试、可演示、可公开协作 | 自动测试、密钥扫描、浏览器验收通过 |
| Stage 1 产品底座 | ✅ 完成 | React/Vite、账号密码、SQLite、角色与审计 | 多用户身份清晰、数据可追踪、默认私有 |
| Stage 2 OpenCode Gateway | 🚧 2B 已完成 | 常驻 OpenCode 服务、会话映射、模型目录 | 不再每条消息冷启动，15–20 人会话可控 |
| Stage 3 知识与方案 | ⏳ 待开发 | FTS5 检索、版本、私有到发布流程 | 知识可查、可审、可撤回、可追溯 |
| Stage 4 Skill 中心 | ⏳ 待开发 | 校验、发布、安装、启用、版本和回滚 | 成员能安全生产并共享 Skill |
| Stage 5 Linux 生产化 | ⏳ 待实施 | 内网部署、内部模型、备份、监控、压测 | 真实环境达到上线检查表要求 |

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
- ▶ Stage 2C：2 Worker 池、粘性 Session、健康检查和按用户公平队列。
- ⏳ Stage 2D：Conversation API、WebSocket 断线续传和前端多会话体验。
- ⏳ Stage 2E：重启恢复、管理后台、20 用户压测和真实 OpenCode 冒烟验收。

出口标准：真实 OpenCode 与内部兼容 OpenAI 协议模型完成联调，Mac 上完成并发和恢复验证。

## Stage 3：知识与方案闭环

目标：让个人经验经过人工确认后成为可复用团队资产。

主要工作：SQLite FTS5；草稿、审核、发布、撤回和版本；对话转知识时明确确认；文件与结构化数据一致性；导入导出和备份恢复。

出口标准：所有公开内容可定位作者、来源、版本和发布时间，并能回滚。

## Stage 4：团队 Skill 中心

目标：普通成员能够开发 Skill，并安全地共享给团队。

主要工作：结构和安全规则校验；自动测试报告；成员自助发布、安装和启用；版本、回滚、禁用、归档和审计。

出口标准：创建、校验、发布、安装、使用到回滚的完整流程通过端到端验收。

## Stage 5：Linux 内网生产化

目标：迁移到公司内网单台 Linux 服务器，服务约 15–20 名成员。

主要工作：非 root 服务账号；Nginx HTTPS 与 WebSocket；内部兼容 OpenAI 协议模型；备份恢复；日志和监控；容量、重启恢复和故障演练。

出口标准：生产检查表全部通过，残余风险和回滚方案由人工确认后再开放访问。

## 不变的边界

- 工作台不直连模型 API，所有推理和 Skill 执行经过 OpenCode。
- Provider 密钥不进入前端、仓库、工作台数据库或日志。
- 用户身份来自账号登录，不来自办公电脑 IP。
- 内容默认私有，发布必须由人确认。
- AI 辅助处理和生成，人负责准确性、风险和最终交付。
