# Requirements Baseline

## Goal

让内网部署模板与 20 活跃任务 Harness 使用同一工作台侧 Runtime 容量契约。

## Non-goals

不连接公司 Provider、MySQL 或 Linux；不承诺模型 API 的 20 路并发能力。

## Acceptance Criteria

- 配置可明确接受 `4 × 5 = 20` 个 Worker 执行槽位与 20 个 Gateway 全局运行任务。
- `GATEWAY_GLOBAL_RUNNING=21` 被拒绝。
- Compose 明确声明 4 Worker、每 Worker 5 槽位和全局 20 任务。
- 文档区分工作台调度上限和 Provider 实际并发。

## Constraints

- OpenCode 仍是唯一 Runtime；生产使用外部 MySQL。
- 不写入公司密钥、URL、证书或模型名称。

## Source Request

持续完成不超过 20 人团队、20 活跃任务的内网工作台目标。
