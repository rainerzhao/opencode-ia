# Stage 1 Product Foundation Requirements Baseline

## Goal

把 Stage 0 的单用户演示基线升级为可持续开发的多用户产品底座，并把工作拆成五个可独立验收、提交和回滚的 Git 阶段。

## Non-goals

- 本轮不建设常驻 OpenCode Gateway；它属于 Stage 2。
- 本轮不接入公司 SSO、Redis、PostgreSQL、向量数据库或收费平台。
- 本轮不把 Provider 地址、API Key 或模型密钥保存进工作台。
- 本轮不宣称 Linux 生产上线完成。

## User-visible Behavior

- 首位管理员只能通过本机命令行创建，不存在公开默认账号。
- 用户使用管理员分配的用户名和密码登录，不开放自注册。
- 登录用户拥有服务端 Session；退出、停用、重置密码和强制退出会撤销 Session。
- 普通成员与管理员看到符合角色权限的功能，所有关键写操作绑定登录用户并进入审计日志。
- 未登录用户只能看到登录页面；演示模式继续可无密钥运行，但使用隔离的演示账号与临时数据库。
- 私人数据默认只对所有者可见，显式发布后才能成为团队共享资产。

## Acceptance Criteria

1. SQLite 启用外键、WAL、忙等待与版本化迁移，运行数据库位于 Git 忽略的数据目录。
2. 密码使用 Node.js `scrypt` 和独立随机盐；数据库不保存明文密码、Session Token 或 CSRF Token。
3. Cookie 为 `HttpOnly`、`SameSite=Lax`，生产 HTTPS 配置启用 `Secure`；写接口需要 CSRF 校验。
4. 登录失败有账号和来源维度的有界限速；API 错误不泄露账号是否存在或敏感字段。
5. `admin/member` 权限、账号停用、密码重置、Session 撤销与审计均有自动化测试。
6. REST 与 WebSocket 都拒绝未认证访问；成员不能读取其他成员的私人资源。
7. Mac 桌面与手机浏览器完成登录、退出、管理员建号和成员访问的端到端验收。
8. 每个阶段完成后执行 `npm test`、`npm run check`、`npm run security:scan`、`git diff --check`，创建中文提交并推送 `main`。

## Constraints

- 所有 AI 推理、Agent、Skill 和工具执行仍必须经过 OpenCode。
- IP 只用于登录安全与网络限制，不作为用户身份。
- 不记录密码、Cookie、Token、API Key、敏感请求头或私人正文到日志。
- 当前开发与验收环境为 macOS Node.js 24；目标生产环境为公司内网单台 Linux。
- 保留现有浅色 UI、知识样例、Stage 0 安全边界与公开 Demo。

## Assumptions

- 使用 Node.js 24 内置 `node:sqlite`，避免引入原生第三方 SQLite 依赖。
- Stage 1 使用服务端、数据库持久化的高熵 Session，不使用 JWT。
- 当前用户已明确授权每个阶段在验证通过后提交并推送公开仓库 `main`。
- 因当前执行规则禁止主动调度子代理，计划与验收复核在当前任务内按多视角清单执行。

## Open Questions

没有阻塞 Stage 1A 的开放问题。生产域名、HTTPS 与 Linux 服务账户在 Stage 5 使用真实环境确认。

## Source Request

用户要求继续开发，设置一个 Goal，把工作拆为多个阶段，并在每个阶段开发完成后上传一次 Git。

## Repo Context

- Repo: `https://github.com/rainerzhao/opencode-ia`
- Branch: `main`
- Base SHA: `9014062af8de0a3fae70353d723a82b37c3ba82e`
- Starting state: clean and aligned with `origin/main`
- Approved design: `docs/superpowers/specs/2026-09-01-team-ai-workbench-design.md`
