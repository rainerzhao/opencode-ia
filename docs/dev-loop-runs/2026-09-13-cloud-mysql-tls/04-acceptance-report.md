# 验收

## Verdict

PASS：本次云数据库 TLS 应用级交付通过。

## Evidence

- TLS 配置、备份恢复、生产配置和常规配置定向测试 24/24 通过。
- `WORKBENCH_TLS_ACCEPTANCE=1 node --test test/integration/mysql-tls.test.js`：1 passed，0 failed。临时真实 MySQL 8.4、动态测试证书、TLS cipher 非空；错误 CA 和错误主机名均拒绝连接。管理员 CLI 与生产组合读取同一 CA，MySQL 原生客户端完成加密备份恢复。
- `docker compose -f deploy/compose.intranet.yaml -f deploy/compose.mysql-tls.yaml config --quiet`：占位配置解析通过。
- `WORKBENCH_TEST_MYSQL_URL=… WORKBENCH_TLS_ACCEPTANCE=1 npm test`：365 tests，360 passed，0 failed，5 个真实 OpenCode opt-in 验收跳过。包含真实 MySQL 8.4 业务回归及独立 TLS 实例。
- `npm run build`、`npm run check`（180 files）、`npm run security:scan` 和 `git diff --check` 均通过。
- 临时 TLS 数据库容器及证书按测试清理逻辑销毁；原有本机开发测试库保留。

## Remaining

上述证据来自 Mac 的 Docker 测试库，不能证明公司云数据库网络、真实证书、生产备份策略或 Linux 发布镜像已验收。5D/5E 继续保持开放。
