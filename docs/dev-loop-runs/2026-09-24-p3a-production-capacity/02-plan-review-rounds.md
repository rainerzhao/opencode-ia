# Plan Review Rounds

## Round 1

### Architecture

- Verdict: APPROVED。
- 将生产路径 Harness 与旧 SQLite runtime Harness 分开，避免修改既有快速回归语义。

### Test strategy

- Verdict: APPROVED_WITH_CHANGE。
- IMPORTANT：真实公司依赖不能在普通 CI 运行；必须用可单测的 fail-closed profile 固定 Linux、空验收库和拓扑。
- Resolution：Task 1 增加独立 profile 与 RED/GREEN 单测，真实集成测试默认 skip。

### Product/spec

- Verdict: APPROVED_WITH_CHANGE。
- IMPORTANT：不得把“Harness 已实现”写成“真实容量已验收”。
- Resolution：Task 3 统一使用“生产路径 Harness 就绪、公司执行待完成”。

### Risk/security

- Verdict: APPROVED_WITH_CHANGE。
- BLOCKER：不得自动清理远端 MySQL，也不得允许误指向共享生产库。
- Resolution：要求全新且库名含 `acceptance`，首位管理员初始化失败即终止，不提供 reset/cleanup。

## Exit

所有 BLOCKER、IMPORTANT 和 QUESTION 均已在计划中解决；进入 TDD 实现。
