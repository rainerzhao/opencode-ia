# Implementation Log

## Baseline finding

`test:capacity:20:real` 使用真实 OpenCode，但服务由 `createAuthenticatedWorkbench` 创建，持久层是测试 SQLite。它能验证 Runtime、会话和调度，不能证明 MySQL production composition。

## TDD cycles

1. 新增 profile 测试和 deployment contract；首次运行因模块与 Harness 文件不存在而失败。
2. 实现 `loadProductionCapacityProfile` 与 opt-in production Harness；聚焦测试转绿。
3. 增加 Harness 必须调用 production/provider 门禁的契约；确认失败后实现并转绿。
4. 增加 MySQL 必须使用 TLS 的用例；确认普通 `mysql://` 被错误接受后，改为只接受 `mysqls://`。
5. 增加 `maxUserRunning` 契约；实现管理员 Job 元数据采样，运行中即时拒绝单用户并发超过 1。

## Implementation

- `src/gateway/production-capacity-profile.js`：显式开关、Linux、TLS acceptance 专用库、固定 4×5/20/1 拓扑；只返回脱敏 profile。
- `test/integration/production-capacity.test.js`：生产与 Provider 门禁、全新数据库 bootstrap、MySQL production composition、20 个账号、20 WebSocket、60 Conversation、3 轮 180 个真实 OpenCode 任务、上下文标识、跨 Conversation 串线、跨账号 404、队列和单用户并发检查。
- `package.json`：新增 `test:capacity:20:production`，保留原 runtime-only Harness 兼容性。
- 产品与运维文档：明确 SQLite runtime Harness 与 MySQL production Harness 的证据边界。

## Safety rulings

- 不增加远端数据库 reset：要求操作员提供全新 acceptance 专用库；首位管理员初始化失败即停止。
- 不在 Mac 绕过 Linux 门禁；本机显式命令必须失败。
- 不输出 Prompt、回复、Cookie、数据库 URL 或密钥；成功摘要只包含计数、拓扑、耗时与队列峰值。
- 当前协作策略不允许主动派生评审代理，因此采用 requirements/test/code/security/compatibility 五个视角的结构化内联复核。

## Verification

- 聚焦：6 pass，0 fail；production integration 在普通模式 1 skip。
- `npm test`：423 total，398 pass，0 fail，25 skip。
- `npm run build`：41 modules transformed。
- `npm run check`：207 files passed。
- `npm run security:scan`：no findings。
- `git diff --check`：通过。
- `npm run test:capacity:20:production`（Mac）：按设计失败，错误码 `PRODUCTION_CAPACITY_LINUX_REQUIRED`。
