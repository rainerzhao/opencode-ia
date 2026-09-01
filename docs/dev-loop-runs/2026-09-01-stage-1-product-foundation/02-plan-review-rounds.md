# Stage 1 Plan Review Rounds

## Round 1

### Architecture Review

**Verdict:** APPROVED

- Expand-first：先增加数据库与仓储，不移除现有文件链路，保证每次推送后应用仍可运行。
- 身份与权限稳定后再迁移 React，减少同时改变协议、数据模型和渲染框架的风险。
- Node 24 内置 SQLite 满足 Mac 与目标 Linux 的单机 15–20 人规模，不引入额外服务。

### Security Review

**Verdict:** APPROVED WITH CLOSED COMMENTS

- `IMPORTANT S1-SEC-1`：数据库不得保存 Session/CSRF 明文。计划已明确只保存 SHA-256 哈希。
- `IMPORTANT S1-SEC-2`：不得提供默认管理员密码。计划已明确本机交互式 CLI 创建。
- `IMPORTANT S1-SEC-3`：认证不能只保护 REST。计划 1C 同时覆盖 WebSocket Upgrade/连接。
- `QUESTION S1-SEC-4`：IP 是否作为身份？结论为否，只用于限速与审计元数据。

### Test Strategy Review

**Verdict:** APPROVED

- 每个行为先写失败测试并观察 RED，再实现 GREEN。
- 数据层使用真实临时 SQLite，不 mock 数据库。
- API 使用真实 HTTP/Cookie/CSRF；权限使用至少 admin、member-a、member-b 三个身份。
- UI 变更必须用真实浏览器验证桌面、手机、控制台错误与横向溢出。

### Product Review

**Verdict:** APPROVED

- 无自注册、管理员建号、默认私有和人工发布符合已批准设计。
- 演示模式仍保留，但必须明确演示账号和模拟 AI，不与真实账号数据混用。

## Approval Conditions

Round 1 后不存在未解决的 `BLOCKER`、`IMPORTANT` 或 `QUESTION`。允许从阶段 1A 开始串行实施。
