# Acceptance Report

- 全量：346 tests，341 passed，0 failed，5 个真实 OpenCode opt-in 场景跳过。
- MySQL 8.4：内容、Gateway、Skill、账号认证、HTTP/WebSocket 组合通过。
- 备份恢复：32263 字节 SQL dump、SHA-256 manifest、附件 sidecar 恢复通过。

边界：公司 Linux 预发布机、真实内部 Provider、遗留接口退役和生产回滚仍未验收。
