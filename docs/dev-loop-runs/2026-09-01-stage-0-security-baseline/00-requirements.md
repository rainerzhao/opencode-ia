# Requirements Baseline

## Goal

在不改变现有产品定位和用户数据的前提下，为团队 AI 工作台建立可测试、可配置的安全运行基线，消除已发现的明文密钥、命令注入、路径逃逸、任意 URL 抓取、上传落盘和会话并发风险。

## Non-goals

- 本阶段不完成 React 迁移。
- 本阶段不实现账号体系、SQLite 业务模型、知识版本或 Skill 发布中心。
- 本阶段不把每次 `opencode run` 改为完整的 OpenCode 常驻服务架构；只建立安全可取消的进程边界，为阶段 2 替换 Gateway 做准备。
- 本阶段不变更模型 Provider 或轮换供应商侧密钥。
- 本阶段不提交、推送或发布到外部仓库。

## User-visible Behavior

- 现有页面和知识管理入口仍可启动。
- 聊天输入不再经过 Shell 解析。
- 超时、会话忙、会话数已满和 URL 未授权以明确错误返回。
- 非法知识路径、上传分类和文件名被拒绝，不能读写知识根目录之外的文件。
- URL 抓取默认关闭，只允许管理员通过环境变量显式授权的主机。
- 浏览器断开后，当前 OpenCode 子进程会被取消。

## Acceptance Criteria

- 项目扫描不到明文 API Key 模式。
- OpenCode 参数化调用测试证明包含 shell 元字符的输入只作为单个参数传入。
- 路径安全测试覆盖 `../`、绝对路径、NUL、相似前缀目录和正常中文路径。
- API 集成测试证明知识读取、保存、新建、删除、上传和 URL 抓取应用统一安全策略。
- WebSocket 集成测试证明 `MAX_SESSIONS` 生效、同一会话不能并发执行、断开连接会终止运行。
- 超时、输出上限、非零退出和无正文输出均产生结构化错误。
- `npm test`、`npm run check` 和 `npm run security:scan` 成功。
- 本地浏览器能够打开现有 UI，配置接口和知识树可用，控制台无新增关键错误。

## Constraints

- 所有 AI 推理和 Skill 执行仍经过 OpenCode。
- 使用 Node.js 内置 `node:test`，阶段 0 不增加测试框架。
- 不依赖真实模型完成普通自动化测试。
- 保留现有知识文件和页面资产。
- 所有路径、端口、OpenCode 命令和限制由环境变量或配置对象提供。
- 生产代码修改遵循测试先行。

## Assumptions

- 当前开发机 Node.js 24.15.0 可用；生产最低版本在阶段 1 锁定为 Node.js 22 LTS 或更新版本。
- OpenCode 可执行文件支持 `run --format json`；本阶段用本地夹具测试进程协议。
- URL 抓取的安全默认值为无授权主机，因此未配置白名单时接口返回禁止访问。
- 真实 API Key 的供应商侧轮换由用户完成；代码只能清除已暴露副本并阻止再次进入项目。

## Open Questions

无阻塞问题。Git 初始化与本地提交在执行方式选择时单独获得授权。

## Source Request

用户要求把现有原型改造成完整项目，并优先处理已识别的安全问题。总体设计已在 `docs/superpowers/specs/2026-09-01-team-ai-workbench-design.md` 书面确认。

## Repo Context

- 项目当前不是 Git 仓库。
- 后端集中在 `server.js`，启动时立即监听端口。
- 前端集中在 `public/index.html`、`public/style.css` 和 `public/app.js`。
- 当前没有自动化测试和 check 脚本。
- `PROJECT_HANDOFF.md` 命中明文密钥模式。

