# Acceptance Report

## Evidence

- 内容 API 工作流包含导出 → 导入 → 私有新草稿 → 附件下载闭环。
- 摘要错误返回 400，未写入附件；React UI 契约包含导入入口。
- 全量回归：337 tests，321 pass，0 fail，16 个需要真实外部环境的测试跳过。
- 构建、JavaScript 语法检查、密钥扫描和 `git diff --check` 全部通过。
- 浏览器 demo 已在 1440×900 与 390×844 验证导入入口，无横向溢出和页面错误；截图见 `knowledge-desktop.png`、`knowledge-mobile.png`。
- 本阶段仍需在 Linux 预发布环境完成真实 MySQL 恢复演练和完整 Stage 3 验收。
