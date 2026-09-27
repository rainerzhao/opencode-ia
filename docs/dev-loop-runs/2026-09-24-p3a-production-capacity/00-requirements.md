# Requirements Baseline

## Goal

补齐一个同时走 MySQL 单一事实源、真实 OpenCode Runtime、20 个账号、60 个持久 Conversation 和 180 个多轮任务的 P3A 生产路径容量验收入口。

## Non-goals

- 不在 Mac 或普通 CI 中伪造公司 Linux、内部 Provider 或云 MySQL 已验收。
- 不自动清空、覆盖或删除任何数据库。
- 不承诺模型 Provider 的吞吐 SLA。
- 不改变浏览器、REST、WebSocket 或 OpenCode 协议。

## User-visible Behavior

- 维护者可通过一个显式命令运行生产路径容量验收。
- 普通 `npm test` 明确跳过该真实环境门禁。
- 入口缺少 Linux、专用验收库或显式开关时失败关闭。
- 输出只包含拓扑、数量、耗时和错误类型，不包含 Prompt、回复正文、Cookie、数据库 URL 或密钥。

## Acceptance Criteria

1. 新命令必须使用 `createMySqlProductionWorkbench`，不得使用 SQLite fixture。
2. 必须实际启动 4 个 OpenCode Worker、每个 5 槽位、全局 20 活跃任务、单用户 1 活跃任务。
3. 必须创建 20 个账号、每人 3 个 Conversation、完成 3 轮，共 180 个真实任务。
4. 必须验证跨轮标识、跨 Conversation 不串线、跨账号读取返回 404、队列出现且单用户并发不越界。
5. 只允许全新、名称含 `acceptance` 的专用 MySQL 数据库；不提供自动 reset。
6. README、Provider 联调清单、公司交接清单、产品目标和路线图必须准确区分旧的 SQLite Runtime Harness 与新的生产路径 Harness。

## Constraints

- OpenCode 仍是唯一 Agent Runtime。
- Provider 凭证只由受保护的 OpenCode 配置读取。
- 生产业务数据只进入 MySQL。
- 本轮只能证明 Harness 可执行；未在公司环境运行前 P3A/P3B 仍为未完成。

## Assumptions

- 公司预发布验收会提供一个全新专用数据库，库名包含 `acceptance`。
- 验收主机提供 OpenCode 可执行文件、受保护 Provider 配置和所需 CA。
- 操作员接受验收库保留本次审计数据，不由 Harness 自动清理。

## Open Questions

无阻塞问题；默认采用专用空库而不是对共享预发布库做破坏性清理。

## Source Request

延续当前 Goal，完成可部署至公司内网 Linux 的版本，并验证真实 20 用户、多会话、MySQL、OpenCode、隔离和恢复边界。

## Repo Context

- Base SHA: `678bc21`
- Branch: `main`
- 现有 `test:capacity:20:real` 走真实 OpenCode，但使用 `createAuthenticatedWorkbench` 的 SQLite fixture。
- 工作区存在 4 份既有无关未跟踪材料，本阶段不修改、不提交。
