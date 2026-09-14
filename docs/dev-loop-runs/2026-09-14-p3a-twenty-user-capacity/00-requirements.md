# Requirements Baseline — P3A 20 用户承载验收

## Goal

将既有 5 账号/15 会话多轮验收扩展为可重复的 20 账号 × 3 私有 Conversation × 3 轮任务，用以验证 Gateway 的公平调度、会话隔离、历史完整性与受限执行槽位。

## Non-goals

- 不把模拟模型或 Mac 压测写成公司 Provider、Linux 容量或生产 SLA。
- 不提高模型 API 的实际并发，也不绕过 OpenCode Gateway。
- 不改变“持久会话数、在线用户、Worker 数和执行槽位分离”的架构。

## Acceptance Criteria

1. 明确的 20×3×3 模式会创建 20 个真实登录账号、60 个私有 Conversation，并完成 180 个三轮请求。
2. 每个回答保留本会话标识，不能包含其他会话标识；跨账号读取必须为 404。
3. 测试记录 Worker、执行槽、队列峰值、每用户并发峰值、每轮耗时和完成数；队列存在且所有会话完成。
4. 默认 CI 保持小规模、快速的模拟模式；20 用户模式只能显式开启。
5. 文档准确说明模拟与真实 OpenCode/公司环境证据的边界。

## Constraints

- 使用现有认证 HTTP、WebSocket、Gateway、Fair Queue 和 Worker Pool，不创建旁路执行器。
- 默认保持单用户同时执行不超过 1；20 个请求可排队但不等同于 20 个模型流并发。
- 不接触现有无关未跟踪材料。
