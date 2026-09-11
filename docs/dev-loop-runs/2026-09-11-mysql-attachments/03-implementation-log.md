# Implementation Log

## 2026-09-11

- 新增 MySQL 附件 sidecar 失败测试，确认旧脚本因不识别 `--attachments` 而 RED。
- `backup-mysql.js` 增加附件目录复制、逐文件 SHA-256 manifest、符号链接拒绝、独立清单和失败清理。
- `restore-mysql.js` 增加附件清单校验、路径边界检查、摘要校验、拒绝覆盖和临时目录原子替换。
- 更新 README、ROADMAP、内网部署手册中的备份恢复说明。

## 定向验证

- `node --test --test-concurrency=1 test/ops/mysql-backup.test.js`：5 pass。
