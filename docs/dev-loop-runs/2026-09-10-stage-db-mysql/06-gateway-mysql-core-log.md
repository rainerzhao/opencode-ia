# Task 3A.1 — MySQL Gateway durable core

## Scope

实现 Gateway 的 MySQL 持久核心：私人 Conversation、Job、事件流、Worker、OpenCode Session 绑定和启动恢复。此步骤不把该仓储接入正式 Gateway 调度服务，因此不会出现 SQLite Gateway 与 MySQL Gateway 并行处理同一任务的情况。

## TDD evidence

1. 先创建 `test/gateway/mysql-gateway-store.test.js`，在真实 MySQL 上要求模块存在并覆盖私有边界、幂等、事件序号、绑定和重启恢复；首次运行因模块不存在而 RED。
2. 实现异步 MySQL Repository 后，真库用例 GREEN。
3. 审查发现 MySQL Worker 写入遗漏旧 Store 的 `processId >= 1` 约束；补上 RED 用例，确认 MySQL 曾接受 `0`，随后修复并 GREEN。

## Verified behavior

- 同一用户相同 idempotency key 只创建一个 Job；复用到不同输入会被拒绝；
- 任务创建与两条初始事件、状态变更与状态事件均在同一 MySQL transaction 中提交；
- `AUTO_INCREMENT` sequence 提供可重放的单调事件顺序；
- Worker、Conversation 与 OpenCode Session 是独立记录；重启时只中断未知 running Job，并将 active Session 标记为 recovering；
- 用户不能读取另一用户的 Conversation 事件。

命令：`WORKBENCH_TEST_MYSQL_URL=… node --test test/gateway/mysql-gateway-store.test.js`，结果 1 passed、0 failed；语法检查通过。

## Remaining boundary

Gateway Service、恢复器、REST/WebSocket 路由仍依赖同步 SQLite Store，尚未调用本仓储。下一步必须先将这些调用链整体异步化，再进行 MySQL 应用组合验收。

## Task 3B.1 — recovery async protocol

恢复器的 Store 调用已全部改为等待：启动恢复报告、排队 Job、Session 恢复状态、边界事件和中断状态更新均按顺序完成。新增延迟 Promise Store 回归先验证旧实现会把 Promise 当可迭代队列，再确认修复后恢复报告与 Worker 启动顺序正确。此项保留同步 SQLite Store 兼容，但尚未将 MySQL Gateway Repository 接入运行时。

## Task 3B.2 — async fair selection

公平队列新增 `nextEligibleAsync()`，可以在不移出队首任务的前提下等待 MySQL Session/Worker eligibility。回归确认异步拒绝某一用户时仍轮转到下一用户，恢复可用后保持原用户 FIFO。Gateway Service 尚未切到该方法，因此产品运行语义不变。

## Task 3B.3 — Conversation REST async boundary

Conversation 的创建、列表、读取、重命名、归档与管理员元数据接口都已等待 Store 返回值；错误仍经过原有状态映射。Promise Store RED 曾返回空 Conversation 并丢失审计 target ID，修复后私有会话、CSRF、审计和管理员最小元数据回归通过。该接口目前仍由 SQLite Gateway Store 提供数据，未将 MySQL Gateway 接入正式服务。

## Task 3B.4 — Gateway WebSocket async boundary

Gateway WebSocket 的订阅和提交现在等待 Gateway Service。回归先让 `subscribe()` 返回 Promise，确认旧代码在连接关闭时会把 Promise 当取消函数；修复后正确保存并调用异步返回的取消函数，既有事件重放、取消所有权和认证回归保持通过。

## Task 3B.5 — async idempotent submission

Gateway Service 的提交路径现识别 Promise Store：先等待幂等查询，再创建 Job、入公平队列、发布事件并请求调度。同步 SQLite Store 仍保持原返回形态，避免尚未迁移的调用者被强制改造。真库 RED 发现 MySQL Repository 缺少幂等 Job 查询；补齐后验证 MySQL Job 正确进入队列。Worker 选择和执行路径仍待整体异步化，不能将此写成 MySQL Gateway 已上线。
