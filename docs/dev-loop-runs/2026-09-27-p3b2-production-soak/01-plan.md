# Implementation Plan

## Architecture Summary

复用同一个 `production-capacity.test.js` 生命周期：capacity → recovery → restart/history → optional soak。新增纯 profile 负责 gate 与时间边界，新增纯 schedule 负责 5 人 cohort 轮转；集成 Harness 只消费已验证参数，不复制边界逻辑。

## Task 1: Soak profile and schedule

- Create `src/gateway/production-soak-profile.js`，导出 `loadProductionSoakProfile({ env, platform })`。
- Create `test/fixtures/production-soak.js`，导出 `createProductionSoakSchedule({ users, cohortSize, durationMs, intervalMs })`。
- Test invalid gates、duration/interval、少于四轮、脱敏 frozen profile，以及 20 人四轮完整覆盖和稳定轮转。

## Task 2: Command and integration contract

- Modify `package.json` and `test/ops/deployment-contract.test.js`。
- 新命令精确打开 capacity/recovery/soak；duration/interval 继续由操作员环境显式提供。
- 契约要求 Harness 使用 profile、schedule、`/healthz`、Gateway health、marker 与安全摘要。

## Task 3: Long-running real task loop

- Modify `test/integration/production-capacity.test.js`。
- 在整机重建和五任务历史复读后，重新登录 20 个账号，各创建一个长稳 Conversation 和 WebSocket。
- 按 schedule 每轮激活 5 人；首次写入 marker，后续要求从上下文返回；等待全部 completed 并检查串线。
- 每轮完成与轮次间每 30 秒采样 unauthenticated `/healthz` 和 admin Gateway health；任何 degraded/unhealthy 或任务非 completed 立即失败。
- 输出仅含 `durationMinutes`、`intervalSeconds`、`cycles`、`completed`、`healthSamples`、`maxCycleMilliseconds`。

## Task 4: Handoff and verification

- Update README、PRODUCT_GOAL、ROADMAP、company preflight、internal Provider。
- Run profile/schedule/contract RED→GREEN、default skip、Mac explicit fail-closed、full suite、build、syntax、secret scan、diff check。
- Complete implementation log、acceptance report、HTML summary；中文提交并推送 main。

## Risks

- 模型响应超过循环间隔时下一轮立即开始，但同一账号仍由单用户并发 1 和每 Conversation 串行规则保护。
- Runtime/Provider 的短暂退化会成为失败证据，不自动重试成成功。
- 长稳任务会产生真实模型成本，必须由公司操作员显式选择时长和间隔。

## Acceptance Mapping

- AC1–AC3：Task 1/2。
- AC4–AC7：Task 3。
- AC8：Task 4。
