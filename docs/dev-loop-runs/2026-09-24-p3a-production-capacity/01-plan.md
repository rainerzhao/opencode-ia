# Implementation Plan

## Architecture Summary

增加一个小型生产容量配置闸门与一个 opt-in 集成 Harness。配置闸门负责 Linux、显式开关、专用验收库和固定拓扑；集成 Harness 直接启动 MySQL production composition 和真实 OpenCode Worker，通过真实 HTTP/WebSocket 完成 20×3×3 流程。普通测试仅验证闸门和代码契约，真实命令需公司环境执行。

## Task 1: Fail-closed acceptance profile

- Create `src/gateway/production-capacity-profile.js`.
- Create `test/gateway/production-capacity-profile.test.js`.
- RED：模块不存在；GREEN：只接受 Linux、`WORKBENCH_PRODUCTION_CAPACITY_ACCEPTANCE=1`、库名含 `acceptance`，并固定 4×5/20/1/20×3×3。

## Task 2: MySQL plus real OpenCode integration Harness

- Create `test/integration/production-capacity.test.js`.
- Modify `package.json` and `test/ops/deployment-contract.test.js`.
- RED：生产路径脚本和文件契约不存在；GREEN：命令直接启动 `createMySqlProductionWorkbench`，在全新专用库初始化管理员，经 HTTP 创建和登录 20 个成员，经 WebSocket 完成 180 个任务并输出脱敏摘要。

## Task 3: Product and operator handoff

- Modify `README.md`, `docs/operations/internal-provider.md`, `docs/operations/company-preflight-handoff.md`, `docs/PRODUCT_GOAL.md`, and `docs/ROADMAP.md`.
- 明确旧命令是 SQLite + real OpenCode runtime Harness；新命令才是 MySQL production composition + real OpenCode，但尚待公司执行。

## Verification

- `node --test test/gateway/production-capacity-profile.test.js test/ops/deployment-contract.test.js`
- `npm test`
- `npm run build`
- `npm run check`
- `npm run security:scan`
- `git diff --check`
- `npm run test:capacity:20:production` 在当前 Mac 必须因 Linux/公司配置门禁失败或显式跳过，不得伪装成功。

## Risks and Assumptions

- 真实 Provider 的速率限制可能使公司运行失败；这应作为验收事实保留，不能切回模拟模式。
- Harness 不自动清理数据库，避免对远端云数据库执行破坏性操作；因此要求全新专用验收库。
- 当前策略不允许主动派生评审代理，计划与验收采用结构化内联复核并在报告中记录。

## Acceptance Mapping

- AC1/AC2：Task 1 配置闸门 + Task 2 production composition。
- AC3/AC4：Task 2 HTTP/WebSocket 多轮流程与运行采样。
- AC5：Task 1 专用库名和全新数据库门禁。
- AC6：Task 3 产品与运维文档。
