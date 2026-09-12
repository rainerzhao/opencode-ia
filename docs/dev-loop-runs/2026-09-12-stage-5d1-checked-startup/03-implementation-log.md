# Stage 5D1 Checked Startup Implementation Log

- 新增 `scripts/start-production.js`，两项 preflight 全部成功后才启动应用。
- Provider 门禁增加服务账号文件所有权校验。
- Dockerfile 和 systemd 切换到受检入口；镜像预创建 `node` 用户可写的数据目录。
- 新增 `.dockerignore`，排除本机配置、Git、依赖、构建产物、运行数据、数据库、日志、测试和交接材料。
- 根据生产架构决策，Compose 删除自建 MySQL、root 密码、数据库数据卷和服务依赖，只要求受保护环境提供公司云 MySQL 的完整 `WORKBENCH_DATABASE_URL`。
- 部署契约测试明确禁止生产 Compose 回退到自建 MySQL；运维手册将实例高可用、自动备份和基础监控归属公司云数据库平台。
- 审查发现生产配置门禁与 Provider 所有权门禁可能使用不同 UID；新增回归测试先复现失败，再让启动器向两项门禁传递同一服务账号 UID。
- Linux/amd64 构建被本机 Docker Desktop 配置的阿里云镜像代理 403 阻断；未修改全局 Docker 设置。AWS Public ECR 已下载并校验部分同源基础层，但剩余层长时间无进度后安全取消，不能视为目标镜像已构建。
