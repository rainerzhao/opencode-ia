# MySQL-only 服务组合 Requirements

## Goal

让生产启动器能够在明确配置 MySQL 8.4 时，将所有业务 Repository 装配到同一个异步数据库，并拒绝 SQLite/MySQL 混合事实源。

## Acceptance Criteria

1. 启动前检查 MySQL 能力并执行迁移。
2. 认证、审计、Gateway、内容和 Skill 依赖全部来自注入的 MySQL Repository。
3. 未配置 MySQL 时保留 Mac SQLite Demo；配置 MySQL 时不打开 SQLite 业务库。
4. README 和无密钥示例配置说明切换边界；本阶段不宣称 Linux 生产完成。
