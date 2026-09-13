# 计划

1. 固定 checkout/setup-node 的已查询 Action SHA，使用只读权限。
2. 在 Ubuntu 24.04/Node 24 安装锁定依赖，执行构建、语法和密钥扫描。
3. 使用开发测试 Compose 启动临时 MySQL 8.4，运行全量回归和 TLS 专项。
4. 构建实际 deploy/Dockerfile 镜像，检查非 root、前端产物、持久目录写入和构建上下文排除项。
5. 验证缺少生产配置时入口退出失败，始终清理临时测试数据库。
6. 推送后跟踪对应 commit 的 Actions 结果，修复发现的问题。
