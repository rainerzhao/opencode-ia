# MySQL 附件备份计划

1. 先在 `test/ops/mysql-backup.test.js` 增加 sidecar、摘要、符号链接和恢复清理测试，确认当前实现 RED。
2. 扩展 `scripts/backup-mysql.js`：解析 `--attachments`，使用独立 sidecar 和 manifest，拒绝链接并原子清理。
3. 扩展 `scripts/restore-mysql.js`：验证附件清单，复制到新目录并拒绝覆盖、路径逃逸和摘要漂移。
4. 更新 README、ROADMAP 和内网运维手册，明确已实现边界与未完成的真库恢复演练。
5. 执行定向测试、全量测试、构建、语法、安全扫描和 diff 检查，提交并推送。

## Verification

- `node --test --test-concurrency=1 test/ops/mysql-backup.test.js`
- `npm test`
- `npm run build`
- `npm run check`
- `npm run security:scan`
- `git diff --check`
