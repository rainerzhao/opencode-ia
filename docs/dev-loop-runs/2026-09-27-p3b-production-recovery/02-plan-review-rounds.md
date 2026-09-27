# Plan Review Rounds

## Round 1

- Architecture verdict: APPROVED。复用同一数据库避免第二次 bootstrap 与清库风险。
- Test verdict: APPROVED_WITH_CHANGE。IMPORTANT：纯容量命令不能隐式注入故障；新增独立完整验收命令。
- Product verdict: APPROVED_WITH_CHANGE。IMPORTANT：允许 Session 恢复或安全边界两种结果，不能把不可恢复误报为系统失败，也不能静默丢任务。
- Security verdict: APPROVED_WITH_CHANGE。BLOCKER：输出不得包含 PID、Prompt、回复或配置路径；证据只记录 `processReplaced: true` 与恢复模式。
- Operations verdict: APPROVED_WITH_CHANGE。IMPORTANT：完整验收后必须重启服务并从 MySQL HTTP API 读回历史，而非直接查测试对象内存。

## Resolution

所有 BLOCKER/IMPORTANT 已写入计划与验收标准；进入 TDD 实现。
