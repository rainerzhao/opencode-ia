# Implementation Plan

## Architecture Summary

复用 P3A1 的单次 production composition 与 acceptance 数据库。在 180 个容量任务结束后，只有新 recovery 开关开启时才追加两个任务：第一个启动后杀死其 sticky Worker，第二个留在队列等待恢复。随后重启整个工作台，通过同一 MySQL 和持久数据目录重新登录并读取 Conversation 历史。

## Task 1: Recovery command contract

- Modify `package.json` and `test/ops/deployment-contract.test.js`.
- RED：新命令、精确 recovery 开关和故障/历史断言不存在。
- GREEN：新增 `test:production:acceptance`，保留纯容量命令。

## Task 2: Real Worker failure and recovery

- Modify `test/integration/production-capacity.test.js`.
- 使用已完成任务的 worker binding 定位进程；提交一个运行任务和一个排队任务；`SIGKILL` 后验证前者 interrupted、Worker PID 更新、后者完成且保留 marker 或 interrupted + recovery boundary。
- 证据不输出进程 ID 与正文。

## Task 3: Full service restart and history

- 在相同 env 下停止并重建 `createMySqlProductionWorkbench`。
- 重新登录成员、读取 Conversation 与 `/events`，确认 5 次提交都有 terminal event，已完成的容量历史未丢失。

## Task 4: Handoff and verification

- Update README, PRODUCT_GOAL, ROADMAP and operations docs.
- Run focused tests, normal default skip, explicit Mac fail-closed, full suite, build, syntax, secret scan and diff check.
- Record implementation log, acceptance report and HTML summary；中文提交并推送 main。

## Risks

- 真实模型响应过快时仍在 `job.started` 后立即杀进程，确保故障发生在运行期。
- Worker 端口释放有短暂延迟；依赖现有 Worker Pool restart 机制，不另行重启新池。
- OpenCode Session 不可恢复是允许结果，但必须可见、可审计且排队任务不能重复执行。

## Acceptance Mapping

- AC1/AC2：Task 1。
- AC3–AC5：Task 2。
- AC6：Task 3。
- AC7：Task 4。
