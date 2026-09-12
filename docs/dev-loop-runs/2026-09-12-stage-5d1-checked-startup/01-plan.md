# Stage 5D1 Checked Startup Plan

1. 增加可测试的生产受检启动器，按顺序执行配置门禁、Provider 门禁和应用启动。
2. 验证错误路径不会调用应用启动。
3. 让 Docker 和 systemd 使用受检入口，预创建并授权持久数据目录。
4. 验证 Provider 文件所有权，记录 Compose 宿主机 UID 要求。
5. 增加 `.dockerignore`，缩小构建上下文并阻止本机敏感文件进入镜像层。
6. 将生产 Compose 收敛为单工作台服务，数据库连接指向公司云 MySQL，并以契约测试禁止回退到 Compose 自建数据库。
7. 运行定向测试、Compose 解析、Linux/amd64 镜像构建、镜像内容检查和全量回归。
