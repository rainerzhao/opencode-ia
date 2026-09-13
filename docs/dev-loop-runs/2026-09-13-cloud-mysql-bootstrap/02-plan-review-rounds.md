# 内联审查

APPROVED。没有委派子代理。

- 生产模式显式要求 WORKBENCH_DATABASE_URL，避免历史别名掩盖生产配置遗漏。
- CLI 使用两个连接：一个持有既有迁移 advisory lock，另一个执行身份事务，避免单连接池死锁。
- 迁移先于初始化；已有用户拒绝执行；用户与审计同事务。
- finally 等待异步 MySQL 连接池关闭，失败不会创建备用 SQLite。
- HTTP 集成测试必须由真实 CLI 创建账号，避免直接调用 bootstrap 服务掩盖入口缺陷。
