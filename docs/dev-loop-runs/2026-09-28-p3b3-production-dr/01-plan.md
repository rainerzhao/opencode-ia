# Implementation Plan

## Architecture Summary

继续复用单个 production acceptance 生命周期：capacity → Worker recovery → workbench restart/history → soak → source stop → SQL/attachment backup → empty recovery database restore → recovered production workbench HTTP verification。纯 profile 只负责第四个 gate 与安全的双数据库边界。

## Task 1: DR profile

- Create `src/gateway/production-dr-profile.js` and `test/gateway/production-dr-profile.test.js`。
- 复用 soak profile；验证精确 DR gate、target TLS、recovery/restore + acceptance 命名、源/目标不同和独立 CA。
- 返回冻结脱敏 profile，不返回 URL、主机、库名或路径。

## Task 2: Command and integration contract

- Modify `package.json` and `test/ops/deployment-contract.test.js`。
- 新命令打开四个 gate；target URL/CA 与 soak 时间继续由操作员显式提供。
- 契约要求复用 backup/restore、检查空库、恢复 production workbench、HTTP 事件与安全摘要。

## Task 3: Real application-level DR flow

- Modify `test/integration/production-capacity.test.js`。
- 长稳结束后停止源工作台，在附件根写入随机 canary；用现有脚本生成 SQL/附件 sidecar。
- 用 `createMySqlDatabase` 连接 target 并要求表数为 0；再将备份恢复到 target URL 和全新附件根。
- 使用 target env 重建 production workbench，重新登录成员并读取 P3B1 Conversation 与五个唯一终态；核验 canary 字节。
- 不清理远端数据库；本地临时备份由 Harness root 清理。

## Task 4: Handoff and verification

- Update product/operations docs, implementation log, acceptance report and HTML summary。
- Run focused RED→GREEN、default skip、Mac fail-closed、full suite、build、syntax、secret scan、diff check。
- 中文提交、推送 main、fetch 核对。

## Risks

- `mysqldump`/`mysql` 不存在必须失败，不降级为内存复制。
- 恢复数据库不是空库必须停止，防止覆盖或合并旧数据。
- SQL 与附件不在同一事务；Harness 在源停止后生成一致窗口，并分别校验摘要。
- 恢复后旧 OpenCode Session 可能不可用，但历史读取必须不依赖 Session 恢复。

## Acceptance Mapping

- AC1–AC3：Task 1/2/3。
- AC4–AC8：Task 3。
- AC9：Task 4。
