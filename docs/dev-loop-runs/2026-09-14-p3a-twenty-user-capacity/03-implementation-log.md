# P3A Implementation Log

## Delivered

- 新增受限 profile：默认 `five-user` 供快速回归；`WORKBENCH_TWENTY_USER_ACCEPTANCE=1` 明确启用 `twenty-user`。
- 20 用户 profile 固定为：20 账号、每账号 1 条 WebSocket、每账号 3 个 Conversation、3 轮、5 个执行槽、单用户执行上限 1。
- 多轮验收改为一条 WebSocket 订阅同一成员的多个 Conversation，符合真实浏览器连接与持久 Conversation 的边界；所有事件判断按 Conversation ID 隔离。
- 新增 `npm run test:capacity:20`。

## Root Cause and Fix

首次 20 用户运行在第 21 条 WebSocket 连接超时。服务端 `MAX_SESSIONS=20` 保护的是在线 WebSocket，不是 Conversation 数；原测试为每个 Conversation 建一条连接，错误地把 60 个持久会话等同于 60 位在线用户。修正为每个用户一条连接后，20 条连接可订阅每人 3 条 Conversation，测试按 Conversation ID 判定快照、失败与完成。

## Verified Result

`npm run test:capacity:20`：20 users、20 WebSockets、60 conversations、3 rounds、180 completed；5 execution slots、max user running 1、max queued 55；三轮耗时 584ms、542ms、529ms（本机模拟 Worker）。

## Environment Boundary

`opencode --version` 为 1.18.25；生产 Provider preflight 因当前环境未设置 `OPENCODE_CONFIG_FILE` 停止。没有执行会消耗模型额度的真实 20 用户请求，真实内部 Provider/Linux 容量仍是 P3A/P3B 后续门禁。
