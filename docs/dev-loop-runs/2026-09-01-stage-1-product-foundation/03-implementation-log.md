# Stage 1 Implementation Log

## Baseline

- Base SHA: `9014062af8de0a3fae70353d723a82b37c3ba82e`
- Branch: `main`
- Mode: inline serial execution; one verified commit and push per stage

## Stage 1A

Status: implemented and verified.

### Delivered

- Node 24 内置 SQLite 文件数据库，启用外键、WAL 和 5 秒忙等待。
- 版本化、事务化迁移；失败整批回滚；旧应用拒绝打开更新版本数据库。
- `users`、`login_sessions`、`audit_logs` 初始结构与索引。
- `scrypt` 密码哈希、独立随机盐、恒定时间比较和 12–128 字符策略。
- 用户、Session 和审计仓储；数据库只保存 Session 与 CSRF 的 SHA-256 哈希字段。
- 首位管理员原子初始化与安全审计事件。
- `npm run admin:create -- --username <name> --display-name <name>` 交互式 CLI；拒绝密码参数。

### TDD Evidence

- Database RED: missing `src/db/open-database`; GREEN: WAL/migration/persistence tests passed.
- Password RED: missing `src/auth/password`; GREEN: random-salt/malformed-hash/policy tests passed.
- Bootstrap RED: missing user store; GREEN: one-admin invariant and audit tests passed.
- Session RED: missing session store; GREEN: hash-only storage and revocation tests passed.
- Config RED: `databasePath` undefined; GREEN: default and override tests passed.
- CLI RED: missing `scripts/create-admin.js`; GREEN: real child-process tests passed.
- Schema compatibility RED: newer schema was accepted; GREEN: `DATABASE_SCHEMA_TOO_NEW` stops startup.
- Review RED: database inherited group/other read bits; GREEN: every file database is forced to mode `0600`.
- Review RED: display names accepted embedded control characters; GREEN: control characters are rejected before hashing or writes.

### Verification

- `npm test`: 79/79 passed.
- `npm run check`: 34 JavaScript files passed syntax validation.
- `npm run security:scan`: no findings.
- `git diff --check`: passed.

### Inline Code Review

- Initial verdict: `REQUEST_CHANGES` for database file permissions and display-name control characters.
- Fix verification: targeted database/bootstrap suite 6/6 passed.
- Final verdict: `APPROVE`; no unresolved blocking or important findings.

## Stage 1B

Status: implemented and verified.

### Delivered

- 32-byte高熵不透明 Session 与 CSRF 凭据，SQLite 只保存 SHA-256 摘要。
- `HttpOnly` Session Cookie、前端可读 CSRF Cookie、`SameSite=Lax`、统一路径与可配置 `Secure`。
- 登录、退出、当前用户和修改密码 API；修改密码后撤销该用户全部 Session。
- 管理员建号、列表、重置密码、启停账号和强制撤销 Session API。
- `admin/member` 管理边界；普通成员不能调用账号管理接口。
- 用户名与来源 IP 双维度、有界内存登录限速；成功登录不清空来源 IP 的失败累计。
- 认证和管理员响应统一 `Cache-Control: no-store`，防止身份信息被中间缓存复用。
- 登录、退出、改密、建号、重置、启停和 Session 撤销写入结构化审计事件。

### TDD Evidence

- HTTP RED：认证与账号管理端点返回 `404`；GREEN：真实 HTTP/Cookie/SQLite 用例通过。
- Config RED：认证安全配置未定义；GREEN：默认值、显式覆盖和严格布尔解析通过。
- Review RED：成功登录可清空来源 IP 失败累计；GREEN：只清除用户名维度，保留 IP 防爆破状态。
- Review RED：`/api/auth/me` 和管理员列表可被缓存；GREEN：认证路由组统一返回 `Cache-Control: no-store`。

### Verification

- Targeted authentication suites: 14/14 passed after review fixes.
- `npm test`: 100/100 passed.
- `npm run check`: 47 JavaScript files passed syntax validation.
- `npm run security:scan`: zero findings.
- `git diff --check`: passed.
- Browser report: desktop 1440px and mobile 390px, zero overflow and zero page/console errors; screenshots saved under `artifacts/screenshots/`.

### Inline Code Review

- Initial verdict: `REQUEST_CHANGES` for source-IP limiter reset and cacheable identity responses.
- Fix verification: targeted Service and real HTTP suites passed.
- Final verdict: `APPROVE`; no unresolved `BLOCKER`, `IMPORTANT` or `QUESTION` findings.
- Residual boundary: existing business REST and WebSocket remain anonymous until the independent Stage 1C cutover.
- Git delivery: code commit `8f6c3a5fa43037c012eba963de013ab4d592037c` was pushed to `main` and matched the remote SHA.

## Stage 1C

Status: implemented, verified and delivered to GitHub `main`.

### Delivered

- 所有业务 REST API 统一要求有效账号 Session，所有业务写请求统一要求 CSRF。
- `admin/member` 权限策略；运行会话列表只允许管理员访问。
- 方案记录绑定 `createdBy`，普通成员只能读取自己的私有方案，管理员可管理全部方案。
- 新建、保存、上传和 URL 导入知识写入 `.private/<userId>/`；共享知识与本人私有知识递归合并，同路径以本人内容优先。
- 私有目录和文件强制使用 `0700/0600`，不依赖系统 `umask`。
- 业务身份响应统一 `Cache-Control: no-store`，配置 API 不再返回 OpenCode 工作目录。
- WebSocket Upgrade 使用 Session Cookie 认证并绑定 `userId/role/loginSessionId`；异源浏览器 Origin 被拒绝。
- 每次 OpenCode 执行前重新验证持久化 Session，撤销或停用后关闭旧连接且不触发执行。
- 方案、知识写操作和 OpenCode 执行写入结构化审计，只保留长度、来源 Origin、资源 ID、请求 ID等安全元数据。
- Demo 使用临时 SQLite 和每次启动随机生成的临时管理员密码，退出后删除全部临时数据。

### TDD Evidence

- REST/权限 RED：匿名业务 API、成员全局会话和跨成员方案仍被放行；GREEN：认证、角色和所有者边界通过。
- Knowledge RED：成员可读取另一成员写入的同路径文件；GREEN：每用户私有目录隔离并保留共享只读知识。
- WebSocket RED：匿名/异源连接可建立，运行 Session 无用户身份；GREEN：Upgrade 认证、同源校验和身份绑定通过。
- Revocation RED：已撤销登录 Session 的既有 Socket 仍可调用 OpenCode；GREEN：消息前重验证并以 1008 关闭。
- Review RED：私有文件继承 `0644/0755`；GREEN：方案/知识使用 `0600/0700`。
- Review RED：同名私人分类遮蔽整个共享分类；GREEN：知识树递归合并并按路径去重搜索结果。

### Verification

- `npm test`: 111/111 passed.
- `npm run check`: 53 JavaScript files passed syntax validation.
- `npm run security:scan`: zero findings.
- `git diff --check`: passed.
- Browser UI acceptance: not applicable to this backend-only cutover; Stage 1D owns login UI and browser flows.
- HTML summary browser check was attempted twice, but local Chrome exited before exposing `DevToolsActivePort`, including with the tool-recommended `--no-sandbox`; no Stage 1C screenshot claim is made.

### Inline Code Review

- Initial verdict: `REQUEST_CHANGES` for private filesystem modes, WebSocket Origin validation, revoked-Socket revalidation, and recursive private/shared tree merging.
- Fix verification: targeted authorization, knowledge security, WebSocket and Demo suites passed.
- Final verdict: `APPROVE`; no unresolved `BLOCKER`, `IMPORTANT` or `QUESTION` findings.
- Residual boundary: the static frontend has not yet integrated login; do not present Stage 1C alone as a usable multi-user browser release.
- Git delivery: code commit `cf30d4434891ee693f0e0a57036ab136963e60d9` was pushed to `main`; push output confirmed `4f3c9f2..cf30d44 main -> main`.

## Stage 1D

Status: implemented, verified and delivered to GitHub `main`.

### Delivered

- 独立、可访问的登录页；只提交用户名和密码，不在前端保存或返回 Session Token。
- 统一浏览器认证客户端：所有请求携带同源 Cookie，状态修改请求从唯一、可解析的 CSRF Cookie 自动生成 `X-CSRF-Token`。
- 工作台启动先调用 `/api/auth/me`，未登录跳转登录页；顶栏显示当前用户和角色并支持安全退出。
- `admin/member` 角色感知导航；普通成员不渲染账号管理入口，管理员可查看账号列表。
- 管理员建号、遮蔽输入的密码重置、账号启停和 Session 撤销界面；危险操作要求显式确认。
- 方案记录从 `localStorage` 迁移到受认证、默认私有的 `/api/solutions`。
- 现有配置、Skill、知识与上传请求统一使用认证客户端，不再散落直接 `fetch`。
- WebSocket 仅在认证成功后连接；1008 策略关闭跳回登录页，不进入重连循环。
- 登录页、工作台和账号管理增加 390px 窄屏布局；动态 Skill、方案、知识和文件名进入 HTML 前转义。

### TDD Evidence

- UI RED：`public/auth-client.js` 不存在，认证壳测试无法加载；GREEN：登录表单、CSRF 请求和账号管理契约通过。
- Review RED：密码重置使用普通文本提示框，会明文显示密码；GREEN：原生对话框使用 `type=password` 与 `autocomplete=new-password`，新增契约测试通过。

### Verification

- `npm test`: 116/116 passed in the final full regression.
- `npm run check`: 56 JavaScript files passed syntax validation.
- `npm run security:scan`: zero findings.
- `git diff --check`: passed.
- Browser desktop 1440×1000: login, logout, administrator account creation, member login and administrator page access passed; no page-level horizontal overflow.
- Browser mobile 390×844: login and member home passed; no page-level horizontal overflow. The top navigation intentionally scrolls horizontally.
- Browser storage inspection: `localStorage` and `sessionStorage` contained no keys before or after login.
- Browser console/page errors: none reported in the completed authentication and account-management flows.
- Screenshots: `stage-1d-login-desktop.png`, `stage-1d-home-admin-desktop.png`, `stage-1d-account-admin-desktop.png`, `stage-1d-login-mobile.png`, `stage-1d-member-mobile.png`, and `stage-1d-password-reset-dialog.png`.

### Inline Code Review

- Initial verdict: `REQUEST_CHANGES` for plaintext password-reset input and unconfirmed destructive account actions.
- Second security finding: the generic client would attach CSRF to an accidentally supplied cross-origin absolute URL.
- Fix verification: masked reset dialog and UI contract tests passed; revoke/disable now require confirmation; cross-origin requests are rejected before `fetch`.
- Final verdict: `APPROVE`; no unresolved `BLOCKER`, `IMPORTANT` or `QUESTION` findings.
- Residual boundary: xterm remains CDN-hosted and must be locally bundled before internal Linux deployment; React/Vite migration remains Stage 1E.
- Git delivery: code commit `8b7b4d183fee18222162898dc9619bc6554c1c19` was pushed to `main`; `git ls-remote origin refs/heads/main` matched the local SHA.
