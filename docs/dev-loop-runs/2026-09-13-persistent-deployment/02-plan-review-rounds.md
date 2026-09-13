# 内联审查

APPROVED；未委派子代理。

- 发布目录与可变数据分离；保留本地默认路径兼容性。
- 文件附件和 MySQL 元数据共同构成恢复单元，仅备份云 MySQL 不能覆盖附件或 OpenCode 原生 Session。
- systemd 的 ProtectSystem/ReadWritePaths 与新的数据根一致，StateDirectory 由服务管理器创建，ExecStartPre 以服务账号创建 Runtime 目录。
- Docker USER node 与卷初始化所有者一致；既有卷迁移应由运维在停机备份后核验权限。
- 真实 Session 身份测试不等于模型上下文或 Linux 容器重建已验收。
