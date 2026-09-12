# Implementation Log

- 新增 `validateProductionConfig` 和 `npm run preflight:production`。
- 新增 4 个门禁测试：MySQL-only、非 root、Secure Cookie、Runtime 可执行文件和容量上限。
- 更新 README、ROADMAP、内网运行手册。

## Verification

- `node --test --test-concurrency=1 test/ops/production-config.test.js`：4 pass。
- `npm run check`：170 files pass。
