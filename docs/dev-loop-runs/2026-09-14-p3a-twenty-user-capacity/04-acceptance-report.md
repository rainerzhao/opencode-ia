# P3A 20 用户容量验收报告

## Verdict

PASS_WITH_NOTES — Gateway 模拟容量路径通过；真实内部 Provider 与 Linux 未验收。

## Evidence

- `node --test test/gateway/capacity-acceptance-profile.test.js`：3 pass，0 fail。
- `npm test`：382 pass，0 fail，24 个需要真实 MySQL/OpenCode 环境的 opt-in 场景跳过。
- 默认 5×3×3 回归：45 请求完成，跨会话标识隔离、跨账号读取 404。
- `npm run test:capacity:20`：20 登录账号、20 WebSocket、60 私有 Conversation、180 请求完成；最大运行 5、单用户最大运行 1、队列峰值 55。
- `opencode --version`：1.18.25；`npm run preflight:opencode` 明确要求生产 `OPENCODE_CONFIG_FILE`，因此没有把本机模拟结果误表述为真实 Provider 结果。

## Remaining Gates

- 配置公司的 OpenAI 兼容 Provider 后执行显式真实 20×3×3 多轮任务，记录模型错误、限流、耗时和资源数据。
- 在公司 Linux、公司云 MySQL、Nginx/系统服务条件下执行长时容量、取消、Runtime 崩溃、数据库故障和灾备演练。
