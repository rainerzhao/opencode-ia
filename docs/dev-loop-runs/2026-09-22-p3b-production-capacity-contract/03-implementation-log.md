# Implementation Log

1. 新测试先验证旧配置会拒绝 `GATEWAY_GLOBAL_RUNNING=20`，并发现 Compose 缺少 4×5 拓扑声明。
2. 将 Gateway 全局并发的产品最大值调整为 20；Worker 单项配置边界保持不变。
3. Compose 现在固定 4 Worker、每 Worker 5 slots、Gateway 全局 20 运行任务。
4. 定向测试通过：13 pass、0 fail。
5. 完整回归通过：389 pass、0 fail、24 skip；production build、204 文件语法检查和密钥扫描均通过。
6. 以占位 MySQL URL 与临时 OpenCode 路径运行 `docker compose -f deploy/compose.intranet.yaml config --quiet`，模板成功解析；此检查不连接数据库、不读取 Provider 配置，也不启动服务。

公司 Provider、云 MySQL 和 Linux 尚未接入，本阶段不运行真实容量 Harness。
