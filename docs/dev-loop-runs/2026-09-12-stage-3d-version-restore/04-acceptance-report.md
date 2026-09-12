# Stage 3D Version Restore Acceptance Report

## Verdict

PASS_WITH_NOTES

## Evidence

- 定向 SQLite/API/UI/迁移：32 passed，0 failed。
- 定向真实 MySQL/Store：9 passed，0 failed。
- 真实 MySQL 全量回归：351 tests，346 passed，0 failed，5 个真实 OpenCode opt-in 场景跳过。
- 浏览器：知识与方案均完成 v1 → v2 → 恢复为新 v3；确认弹窗、正文刷新、历史入口通过窄屏和桌面观察。
- React/Vite 生产构建、173 个 JavaScript 文件语法检查与密钥扫描通过。

## Residual Risks

- 公司 Linux 预发布、真实内部 Provider、长期容量和灾备仍属于 Stage 5D–5E。
- 默认测试中的 5 个真实 OpenCode 场景为显式 opt-in，不在本轮重复调用真实模型。
