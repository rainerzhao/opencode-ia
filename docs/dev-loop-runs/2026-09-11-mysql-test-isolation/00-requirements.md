# Requirements Baseline

## Goal

让真实 MySQL 8.4 回归在同一专用测试库上可重复执行，且不把前一用例的迁移、账号或审计数据带入后一用例。

## Non-goals

- 不改变任何业务 Store、API 或生产数据库配置。
- 不完成 MySQL-only 服务组合，也不宣称 Linux 生产就绪。

## Acceptance Criteria

1. 迁移用例每次验证首次应用 v1–v5。
2. MySQL 认证和身份仓储用例各自从干净业务数据开始。
3. 清理只允许本机、名称含 `test` 的明确测试数据库。
4. Worker 的“就绪后退出”测试不依赖机器调度时序。

## Constraints

- 专用测试库可以重置，其他数据库绝不允许被夹具清理。
- 不记录数据库凭据、Provider 地址或私有业务正文。
