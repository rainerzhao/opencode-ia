# Requirements Baseline

## Goal

在现有 MySQL + 真实 OpenCode 容量/恢复生产 Harness 后追加可显式开启的长稳阶段，用有限速率覆盖 20 个已登录账号、持续采样工作台与 Gateway 健康，并为公司 Linux 预发布提供可执行入口。

## Non-goals

- 不在默认测试、Mac 或 GitHub 公共 CI 中持续调用模型。
- 不把 Harness 代码存在表述为公司长稳验收通过。
- 不模拟公司 Provider SLA，也不绕过其 429/配额限制。
- 不自动清理远端 acceptance 数据库。

## User-visible Behavior

- 原容量与完整恢复命令保持不变。
- 新增 `test:production:soak`；操作员必须显式提供持续分钟数和循环间隔。
- 完整容量与 Worker/整机恢复完成后，20 个账号重新登录并各持有一个长稳 Conversation；每轮只激活 5 个账号，四轮覆盖全部 20 人，随后循环。
- 每轮验证 marker、跨账号/Conversation 不串线、任务唯一完成；空闲期间持续采样 `/healthz` 与 Gateway 健康。

## Acceptance Criteria

1. 必须精确开启 capacity、recovery、soak 三个 gate，并继续要求 Linux、TLS acceptance 专用库和 4×5/20/1 拓扑。
2. 长稳持续时间必须是 60–1440 分钟整数，间隔必须是 60–3600 秒整数，并确保至少四轮覆盖全部账号。
3. 新命令不得改变 `test:capacity:20:production` 与 `test:production:acceptance` 语义。
4. 20 个账号各建立一条私有长稳 Conversation；每轮 5 人，轮转四轮覆盖全部账号。
5. 首轮写入唯一 marker，后续轮次不在 Prompt 重复 marker，而要求从 Conversation 上下文取回。
6. 任一任务失败/中断/超时、marker 丢失、跨会话串线、健康检查退化或历史异常都必须失败关闭。
7. 成功摘要只输出持续时间、轮数、任务数、健康采样数和耗时，不输出账号、标题、Prompt、回复、PID、Cookie、URL、数据库或配置路径。
8. README、Goal、Roadmap 与公司交接文档标记“长稳 Harness 已就绪，公司实跑待完成”。

## Constraints

- OpenCode 仍是唯一 Agent Runtime。
- 默认不消耗真实模型额度；仅精确 opt-in 后运行。
- 不派生评审代理；按当前协作策略做结构化内联复核。

## Assumptions

- 推荐公司首轮使用 480 分钟、900 秒间隔；这产生约 32 轮、160 个长稳任务。
- Provider 限流属于验收结果，不能通过减少产品配置或切换模拟模型掩盖。

## Open Questions

无阻塞问题。长稳时长与间隔由操作员显式设置，但代码强制最低覆盖与上限。

## Source Request

继续完成 Stage 5E 的长时间运行、真实多人会话和生产验收准备。

## Repo Context

- Base SHA: `eb43a22`
- Branch: `main`
- P3A1 容量与 P3B1 Worker/整机恢复 Harness 已推送。
- 4 份既有无关未跟踪材料继续保留且不纳入本阶段。
