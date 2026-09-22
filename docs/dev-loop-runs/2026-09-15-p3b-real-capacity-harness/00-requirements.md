# Requirements Baseline

## Goal

让公司预发布机可以用一个显式命令验证 20 名用户、每人 3 个持久 Conversation、3 轮共 180 个真实 OpenCode 请求，并以 4 个常驻 Worker、每 Worker 5 个执行槽位证明工作台自身可同时调度 20 个活跃任务。

## Non-goals

- 不在 Mac 或 Demo 上伪造真实 Provider 通过。
- 不修改生产默认 Worker 数量、Gateway 限流或模型 Provider 配置。
- 不保证公司模型 Provider 的并发、延迟或 SLA。
- 不写入 Prompt、响应正文、Cookie、密钥或 Provider 地址到报告。

## User-visible Behavior

- 现有 `npm run test:capacity:20` 保持模拟、5 槽位回归语义。
- 新增 `npm run test:capacity:20:real`，明确设置真实 OpenCode、20 用户、4 Worker、每 Worker 5 槽位。
- 真实模式诊断记录 Worker 数、槽位、完成任务数、队列峰值、跨轮标识隔离和耗时，不记录回复正文。
- 无 Provider/权限/容量时命令失败并保留安全错误码；不降级为模拟成功。

## Acceptance Criteria

1. Profile 默认与既有 P3A 模拟配置完全兼容。
2. 通过受限环境变量可选择 Worker 数与单 Worker 容量；非法值明确拒绝。
3. 实际 Worker Pool 使用 profile 的 Worker 拓扑，20 活跃模式为 4×5=20。
4. 新真实 npm 入口显式设置 `WORKBENCH_REAL_ACCEPTANCE=1`，不能默认为模拟。
5. Profile/unit、集成模拟、构建、静态与密钥检查通过。
6. README/路线图清楚标注“Harness 已具备，真实运行待公司预发布机”。

## Constraints

- OpenCode 是唯一 Runtime；测试通过现有认证 WebSocket → Gateway → Worker 路径。
- 在线用户、持久 Conversation 与执行槽位保持分层；20 个在线用户不自动意味着 20 个模型流。
- 真实验收只能在受保护 Provider 配置、外部 MySQL 与 Linux 服务账号环境执行。
