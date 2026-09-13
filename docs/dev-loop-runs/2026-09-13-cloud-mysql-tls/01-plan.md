# 计划

1. 统一 mysqls 的证书链/主机名校验；读取可选 MYSQL_SSL_CA_FILE，拒绝错误或忽略的 CA 配置。
2. 将 CA 接入应用组合、管理员和生产配置预检。
3. 备份恢复共用 CLI TLS 参数，支持环境连接串，避免进程参数暴露凭证。
4. 提供只读 CA Compose 覆盖文件并更新运维手册。
5. 在临时真实 MySQL TLS 实例验证可信链成功、错误 CA/主机名拒绝、管理员/应用连接、加密 dump/restore。
6. 运行全量真库回归、build、check、security:scan 和 Compose 解析。
