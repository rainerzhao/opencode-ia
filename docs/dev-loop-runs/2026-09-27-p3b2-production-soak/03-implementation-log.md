# Implementation Log

## Baseline finding

P3A1/P3B1 能证明一次 20 用户容量批次和一次 Worker/整机恢复路径，但没有持续到明确时长的真实任务与健康采样；因此不能支撑“长时间运行”结论。

## TDD cycles

1. 新增 soak profile/schedule 测试；首次运行因两个模块不存在而 RED。
2. 实现三个精确 gate、60–1440 分钟、60–3600 秒、至少四轮覆盖和 5 人 cohort 轮转；聚焦 5 项转 GREEN。
3. deployment contract 先要求新命令、profile/schedule、两类健康端点和安全摘要；首次为 3 pass / 1 fail，失败原因是命令不存在。
4. 接入 integration 后 contract 4/4 通过；普通 production integration 仍默认 skip。
5. 复核发现“最后一轮后过早结束”会虚报时长；先增加契约并确认 RED，再补充健康采样直到 `soakStartedAt + durationMs`，契约恢复 GREEN。

## Implementation

- `src/gateway/production-soak-profile.js`：复用 capacity profile 的 Linux/TLS/acceptance 数据库与 4×5/20/1 门禁；额外要求 recovery/soak 精确 gate 和有界时间参数，返回冻结脱敏 profile。
- `test/fixtures/production-soak.js`：生成确定性的 5 人 cohort 轮转；四轮覆盖 20 人，第五轮从首组重新开始。
- `test/integration/production-capacity.test.js`：在容量、Worker 恢复、整机重建和 MySQL 历史复读后，重新登录 20 个账号并各创建一条私有长稳 Conversation；20 个 WebSocket 保持在线，每轮仅 5 人执行。
- 首次任务把 marker 放入 Conversation；后续 Prompt 不再重复 marker，必须从会话上下文返回。每轮拒绝 failed/interrupted/timed_out，检查跨 Conversation 不串线。
- 轮次之间每 30 秒采样 `/healthz` 和管理员 Gateway health；最后一轮后继续采样到完整时长届满。
- 安全摘要仅包含时长、间隔、轮数、任务数、健康采样数和最大轮次耗时。

## Safety and product rulings

- 无静默时长默认；操作员必须显式填写分钟和秒，防止误耗模型额度。
- 推荐 480 分钟/900 秒，约 32 轮、160 个长稳任务；并发容量仍由前置 20 活跃任务阶段验证。
- 任何 Provider 429、任务非 completed、上下文丢失、串线或健康退化直接失败，不自动重试成成功。
- 不输出账号、marker、Prompt、回复、PID、Cookie、URL、数据库或配置路径；不自动清理远端数据库。

## Verification

- Profile/schedule + deployment contract：9 pass / 0 fail。
- Production integration 默认模式：1 skip。
- `npm test`：430 total / 405 pass / 0 fail / 25 skip。
- `npm run build`：41 modules transformed。
- `npm run check`：210 files passed。
- `npm run security:scan`：no findings。
- `git diff --check`：通过。
- 60 分钟/900 秒显式 soak 命令（Mac）：按设计失败，错误码 `PRODUCTION_CAPACITY_LINUX_REQUIRED`。
