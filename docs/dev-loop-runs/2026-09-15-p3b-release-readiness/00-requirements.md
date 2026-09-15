# Requirements Baseline

## Goal

提供一个可在不开启 HTTP 端口、不访问模型或数据库的前提下运行的预发布就绪报告，将现有生产配置与 OpenCode Provider 门禁收敛为一份可保存、脱敏的机器可读证据。

## Non-goals

- 不替代 `npm run start:production` 的强制门禁。
- 不连接 MySQL、Provider、Linux 主机或公司网络；不声称任何真实环境可用。
- 不输出数据库 URL、用户名、密码、Provider URL、API Key、配置文件路径、Prompt 或响应。
- 不改动账号、Conversation、Gateway、Worker 或前端行为。

## User-visible Behavior

- 运维可运行 `npm run preflight:release`，得到稳定 JSON。
- 报告包含 schema 版本、总体 `ready`/`not_ready` 状态，以及生产配置和 Provider 配置各自的 `pass`/`fail` 状态与安全错误代码。
- 任一门禁失败时命令返回非零退出码，但仍输出该报告，便于交接记录。
- 任一门禁通过时，只报告安全类别（MySQL、Secure Cookie、非 root、Provider 数量），不报告敏感值。

## Acceptance Criteria

1. 复用 `validateProductionConfig` 与 `validateOpenCodeProviderConfig`，不复制或放宽其规则。
2. 同时评估两项门禁，不能因第一项失败而跳过第二项。
3. 输出中不存在 URL、凭证、配置路径或任意测试秘密字串。
4. 通过、单项失败、双项失败均有 Node 自动测试。
5. CLI 非零退出码只表示 `not_ready`，不打印堆栈或敏感环境变量。
6. README、路线图和交接清单仅在验证后说明“本地交接工具已具备”，不能写为公司环境通过。

## Constraints

- 生产业务数据仍是外部 MySQL；Compose 不自建数据库。
- OpenCode 仍是唯一 Agent Runtime；该报告不得调用模型 Provider。
- 使用 Node.js、现有 CommonJS 脚本、Node test runner；不增加依赖。
- 用户已授权每个可验收阶段中文提交并推送 `main`。

## Assumptions

- 具体 MySQL 连通性、TLS CA、Linux 非 root 服务账号和 Provider 认证仍由公司预发布机验证。
- 报告生成时间本身不敏感；测试可注入固定时间。

## Source Request

P3B 需要保留 Linux 配置与运行契约、Provider 联调、可观测性、安全隔离、容量和灾备验收，并始终区分本机/Demo 与公司生产证据。
