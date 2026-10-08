# Plan

全阶段计划：[P3B4](../../superpowers/plans/2026-10-08-p3b4-upgrade-rollback.md)。本次只交付任务 1。

顺序：真实临时发布包失败测试 → AST 静态读取 → 清单生成/校验 → CLI → 本仓库迁移格式兼容检查 → 全量回归与文档。

文件：`src/ops/release-manifest.js`、`scripts/release-manifest.js`、`test/ops/release-manifest.test.js`、package/lock、README 与运维说明。

验收覆盖：有效清单、错 SHA/version/schema、缺文件、动态源码、符号链接、拒绝覆盖与脱敏 CLI。命令：`node --test test/ops/release-manifest.test.js`、`npm test`、`npm run build`、`npm run check`、`npm run security:scan`、`git diff --check`。
