# OpenCode 团队 AI 工作台

面向团队内部协作的 AI 工作台首版：浏览器负责交互，Express 后端负责会话、知识文件和安全边界，所有模型推理都经由 OpenCode 执行。Stage 0 已建立可移植配置、进程隔离、WebSocket 并发控制、文件路径保护、上传限制和默认拒绝的 URL 导入策略。

> 当前公开版本是可演示的安全工程基线，不是生产终态。账号体系、SQLite 数据层、React/Vite 工程化、持久 OpenCode Gateway、正式 Skill 发布和审计将在后续阶段完成。

## 本机要求

- macOS（当前开发与验收环境）
- Node.js 24.x（当前验证版本：24.15.0）
- npm 11.x
- 已安装并能独立运行的 OpenCode

安装锁定版本依赖：

```bash
npm ci
```

项目不接收模型 API Key。模型地址和 Provider 凭证只配置在 OpenCode 自己的受保护运行环境中，不写入本仓库、前端、日志或工作台环境变量。

## Mac 快速启动

1. 复制环境变量模板并按本机实际路径修改：

   ```bash
   cp .env.example .env
   ```

2. 在 `.env` 中取消需要项的注释。至少确认 `OPENCODE_CMD` 和 `OPENCODE_CWD`；不要加入模型 API Key。

3. 将配置导入当前终端并启动：

   ```bash
   set -a
   . ./.env
   set +a
   npm start
   ```

4. 打开 `http://127.0.0.1:3000`。如修改了 `PORT`，使用对应端口。

默认 `OPENCODE_CMD` 为 `$HOME/.opencode/bin/opencode`，工作目录为项目根目录。每条聊天消息都以参数数组调用一次受超时、输出大小和取消控制的 `opencode run --format json -- <message>`，不使用 Shell 字符串拼接。

## 配置

`.env.example` 覆盖当前全部运行参数：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `WORKBENCH_ROOT` | 项目目录 | 工作台文件根目录 |
| `PORT` | `3000` | HTTP/WebSocket 端口 |
| `MAX_SESSIONS` | `20` | WebSocket 全局会话上限 |
| `OPENCODE_CMD` | `$HOME/.opencode/bin/opencode` | OpenCode 可执行文件 |
| `OPENCODE_CWD` | 工作台根目录 | OpenCode 每次运行的工作目录 |
| `OPENCODE_TIMEOUT_MS` | `120000` | 单次消息超时（毫秒） |
| `OPENCODE_MAX_OUTPUT_BYTES` | `10485760` | stdout 与 stderr 总字节上限 |
| `KNOWLEDGE_DIR` | `<root>/knowledge` | Markdown 知识目录 |
| `SOLUTIONS_DIR` | `<root>/solutions` | 方案目录 |
| `SKILLS_DIR` | `<root>/.opencode/skills` | 工作台展示的 Skill 目录 |
| `UPLOAD_TEMP_DIR` | `<root>/data/tmp/uploads` | 上传暂存目录 |
| `KNOWLEDGE_FETCH_ALLOWED_HOSTS` | 空 | URL 导入精确主机白名单 |

URL 导入默认禁用。只有明确设置 `KNOWLEDGE_FETCH_ALLOWED_HOSTS` 后才能访问列出的精确主机；不支持通配符，非默认端口必须写为 `host:port`。每次重定向都会重新校验，回环、链路本地、云元数据和未授权地址会被拒绝。

## 发布前验证

```bash
npm test
npm run check
npm run security:scan
```

- `npm test` 只运行 `test/**/*.test.js`，不会把可执行 fixture 当测试发现。
- `npm run check` 对仓库自有 JavaScript 文件执行 `node --check`。
- `npm run security:scan` 扫描仓库文本，只输出相对路径和规则名，不输出疑似密钥原文。

本机运维交接文件 `PROJECT_HANDOFF.md` 和真实 `.env` 被 Git 与扫描器排除，不能提交。若凭证曾在本地文档或其他渠道暴露，删除文本并不能使凭证失效，必须到对应 Provider 侧轮换。

## 当前目录

```text
public/       当前静态前端
src/          后端服务、安全策略与 OpenCode 执行边界
knowledge/    示例 Markdown 知识
test/         Node 内置测试套件
scripts/      语法检查与秘密扫描
server.js     薄启动入口
```

## Linux 迁移边界

生产目标是公司内网单台 Linux 服务器。迁移时保持工作台代码不变，替换 OpenCode Provider 配置、绝对路径和运行环境；建议由非 root 进程运行，使用 Nginx 提供 HTTPS、反向代理和可选内网网段限制，并把应用、OpenCode 配置、数据目录和 Secret 分开管理。

当前版本尚无本地用户名/密码、角色权限、持久会话数据库和正式审计，因此不能直接作为生产多用户系统开放。Linux 上的内部模型 API、权限、备份恢复和 15–20 用户容量仍需在真实环境验证。

## Stage 0 已知限制

- 前端仍为静态页面，React/Vite 工程迁移属于 Stage 1。
- 聊天尚未绑定持久 OpenCode Session；每条消息启动一次有界的 `opencode run`。Stage 2 将引入常驻 OpenCode Gateway、会话映射和流式事件协议。
- 知识库当前以文件为主，SQLite FTS5、版本和发布流程属于 Stage 3。
- Skill 中心当前只展示目录，校验、自助发布、版本、回滚和审计属于 Stage 4。
- 界面中的内部平台地址是演示占位链接，部署时必须替换为经确认的真实入口。
