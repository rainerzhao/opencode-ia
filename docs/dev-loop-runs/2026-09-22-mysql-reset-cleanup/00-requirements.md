# Requirements Baseline

## Goal

修复真实 MySQL 回归在需求字段与草稿迁移后无法可靠重置、并可能遗留连接导致 CI 无法结束的问题。

## Acceptance Criteria

- 测试重置会删除迁移 13/14 的 `requirement_field_templates`、`requirement_field_values`、`requirement_drafts`。
- 重建迁移时不再因残留表而在 migration 13 失败。
- MySQL JSON 标量值可以安全读取。
- 草稿测试清理遵循 `requirement_drafts → conversations → users` 的外键依赖。
- 与 CI 相同的 MySQL/TLS 完整套件结束且无失败。

## Constraints

- 仅使用本机隔离 MySQL 测试容器；不访问公司数据库、Provider 或生产配置。
- 不改变默认私有、OpenCode Runtime 或外部 MySQL 的产品边界。
