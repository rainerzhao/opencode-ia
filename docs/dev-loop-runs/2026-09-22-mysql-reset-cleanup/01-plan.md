# MySQL Reset Cleanup Implementation Plan

## Task 1: Reproduce and isolate

- [x] 使用 CI 等价的 MySQL 8.4 测试容器运行完整套件。
- [x] 记录 migration 13 的残留表错误和两个后续需求测试的错误。
- [x] 将复现缩小到迁移重置与需求仓储测试。

## Task 2: Test-first repair

- [x] 先扩展真库迁移测试的完整表契约，并观察 migration 13 因遗留表 RED。
- [x] 按外键依赖将迁移 13/14 表加入重置删除顺序。
- [x] 处理 MySQL JSON 标量读取与草稿测试清理顺序。
- [x] 运行定向真库测试，确认 GREEN。

## Task 3: Full acceptance

- [x] 运行等价 MySQL/TLS 的完整测试套件。
- [x] 执行构建、语法和密钥检查。
- [x] 提交并推送，并由新的 Linux CI 验证。
