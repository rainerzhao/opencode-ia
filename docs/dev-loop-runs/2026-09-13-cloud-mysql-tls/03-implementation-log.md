# 实施记录

- 新增 4 项测试在原实现失败：证书/主机名标志缺失、CA 被忽略、IP/URL 选项未拒绝、备份恢复环境/TLS 不完整。
- 统一 parseMySqlUrl 的 TLS 规则，显式传递 MYSQL_SSL_CA_FILE 到生产组合、管理员和预检。
- 两个运维脚本共用 mysql-client-options，TLS 模式使用 VERIFY_IDENTITY 和可选 CA，所有连接走 TCP。
- 新增只读 CA Compose 覆盖文件，宿主机文件缺失不会自动创建目录。
- 真实 TLS 实例启用 require_secure_transport。验证非空 TLS cipher、错误 CA/主机名拒绝、管理员初始化、生产应用组合连接和 SQL dump/restore。
- 运行实例使用随机容器名、回环随机端口、临时证书和 tmpfs 数据目录；结束后销毁测试容器和临时文件。
