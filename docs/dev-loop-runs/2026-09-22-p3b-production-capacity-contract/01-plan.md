# P3B Production Capacity Contract Implementation Plan

## Task 1: Configuration boundary

- [x] 写入 20 活跃任务允许、21 拒绝的配置测试，并观察旧的 16 上限 RED。
- [x] 将 `GATEWAY_GLOBAL_RUNNING` 的产品上限调整为 20。
- [x] 运行 `node --test test/config.test.js test/ops/deployment-contract.test.js`。

## Task 2: Deployment contract and handoff

- [x] 在 Compose 模板声明 4 Worker × 5 slots 与 20 个全局运行任务。
- [x] 更新 README、产品目标和内网手册，不把配置契约表述为 Provider 或生产验收。
- [x] 运行完整回归并完成中文本地提交。
- [ ] 在 GitHub 网络恢复后推送并核对远端 SHA。
