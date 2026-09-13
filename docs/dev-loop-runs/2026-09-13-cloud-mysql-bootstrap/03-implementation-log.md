# 实施记录

- 新增 4 个 CLI 行为测试，旧代码全部失败；缺少生产配置、无效 MySQL 均错误返回成功，并实际生成 SQLite 文件。
- scripts/create-admin.js 接入 MySQL 能力检查、迁移、异步仓储和并发初始化锁；保留开发 SQLite 路径。
- 新增 test/fixtures/admin-cli.js，使用真实子进程与标准输入；生产 HTTP/WebSocket 集成测试通过该入口创建管理员。
- 定向真库验收：10 passed，0 failed，包含两个 CLI 并发初始化、审计及登录验证。
