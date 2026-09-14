# P3A 20 用户承载验收 Implementation Plan

**Goal:** 为 OpenCode Gateway 增加显式、可重复的 20 账号 × 3 会话 × 3 轮容量验收，并保留真实 Provider 边界。

**Architecture:** 复用 `five-users-multiround.test.js` 的真实登录、WebSocket 和 Gateway 路径；通过受限环境变量选择验收规模。20 用户模式维持 5 个执行槽和每用户 1 个槽，因此 60 个会话可持久存在、每轮 60 个任务可公平排队，但不会假装 20 个模型请求并发。

## Task Order

1. 为验收配置提取并测试 profile 解析：默认 5×3×3；显式 `WORKBENCH_TWENTY_USER_ACCEPTANCE=1` 为 20×3×3；不合法冲突配置拒绝。
2. 使用 profile 驱动账号创建、任务轨道、轮次诊断和后置断言；20 用户模式校验 60 个会话和 180 个任务全部完成。
3. 新增 `npm run test:capacity:20`，更新产品 README、架构与目标阶段说明。
4. 执行默认回归、20 用户模拟、构建、语法和安全扫描；记录指标和边界后提交推送。

## Risks

- 当前真实 OpenCode 验收曾验证 5×3×3；直接运行 20×3×3 真实模型会消耗内部模型额度且取决于本机 Provider 配置，所以它作为显式人工环境门禁，不在模拟结果中宣称通过。
- 该测试可验证工作台调度路径和隔离，不证明 Linux 长稳、数据库网络、模型配额或生产 SLA。
