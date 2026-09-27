# Implementation Log

## Baseline finding

P3A1 已能在 MySQL production composition 上执行 20×3×3 容量任务，但没有在同一生产路径中证明真实 Worker 异常退出后的进程替换、Session 恢复边界，以及整套工作台重启后的历史持久性。

## TDD cycle

1. 在 deployment contract 中先要求 `test:production:acceptance`、精确 recovery 开关、`SIGKILL`、`conversation.recovery_boundary`、`processReplaced` 与 HTTP 历史读取路径。
2. RED：`node --test test/ops/deployment-contract.test.js` 得到 2 pass / 1 fail，失败原因为新命令不存在。
3. GREEN：增加完整生产验收命令与 recovery gate，补齐故障注入和重启复读逻辑；同一契约得到 3 pass / 0 fail。
4. 普通执行 `test/integration/production-capacity.test.js` 保持 1 skip；在 Mac 显式执行完整命令按设计以 `PRODUCTION_CAPACITY_LINUX_REQUIRED` 失败关闭。

## Implementation

- `package.json`：保留纯容量命令，新增同时打开 capacity/recovery 两个精确开关的 `test:production:acceptance`。
- `test/integration/production-capacity.test.js`：为 OpenCode 设置本次验收生命周期内持久的 XDG 数据/缓存目录；容量阶段后选择一个已建立上下文的 Conversation，提交运行任务与同账号排队任务。
- 通过管理员脱敏 Job 元数据定位运行任务的 Worker，并从工作台内部快照取得真实进程；发送 `SIGKILL` 后要求运行任务中断、同 Worker ID 以不同进程恢复 healthy。
- 排队任务仅允许两种结果：沿用原 Session 完成并保留 marker，或中断且出现 `conversation.recovery_boundary`；失败、无终态和静默重放均不接受。
- 停止整套工作台，使用同一 MySQL、数据根和 OpenCode 持久目录重新创建 production workbench；成员重新登录后经 `/api/conversations/:id/events?afterSequence=0&limit=1000` 验证五个任务各有且只有一个持久终态。
- README、产品 Goal、Roadmap、公司预发布与 Provider 联调文档均明确“生产恢复 Harness 已就绪，公司环境实跑待完成”。

## Safety and review rulings

- 纯容量入口不注入故障；完整入口才执行 Worker 强杀和整机重启。
- 不自动清理远端数据库；继续要求全新 acceptance 专用库。
- 诊断摘要只输出恢复模式、`processReplaced: true` 和安全计数，不输出 PID、Prompt、回复、Cookie、数据库 URL、密钥或配置路径。
- 结构化内联复核覆盖 requirements、test、code quality、security、operations 与 compatibility；无未解决 BLOCKER/IMPORTANT。

## Verification

- deployment contract：3 pass / 0 fail。
- production integration 默认模式：1 skip，符合显式 opt-in 设计。
- `npm test`：424 total / 399 pass / 0 fail / 25 skip。
- `npm run build`：41 modules transformed。
- `npm run check`：207 files passed。
- `npm run security:scan`：no findings。
- `git diff --check`：通过。
- `npm run test:production:acceptance`（Mac）：按设计失败，错误码 `PRODUCTION_CAPACITY_LINUX_REQUIRED`。
