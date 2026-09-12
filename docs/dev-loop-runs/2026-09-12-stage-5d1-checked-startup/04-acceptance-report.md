# Stage 5D1 Checked Startup Acceptance Report

## Verdict

IN_PROGRESS

## Evidence

- 生产入口、Provider 所有权、配置门禁、统一服务 UID 和外部云 MySQL 部署契约定向测试：11 passed，0 failed。
- Linux/amd64 Node 24 非 root 运行壳定向测试：10 passed，0 failed；该证据不替代目标镜像构建。
- 公司云 MySQL 单服务 Compose：`config --quiet` 通过，服务列表只有 `workbench`。
- 真实 MySQL 8.4 全量回归：355 tests，350 passed，0 failed，5 个真实 OpenCode opt-in 验收跳过。
- React/Vite build：通过；JavaScript syntax：175 files passed；密钥扫描：通过。
- 目标 `node:24-bookworm-slim` Linux/amd64 镜像经默认源重试仍在元数据阶段被本机阿里云 Docker mirror 以 403 拒绝；AWS Public ECR 只完成部分层，后续无进度后安全取消，未把该项记为通过。

## Pending

- Linux/amd64 镜像构建与镜像内容检查。
- 公司 Linux 上的云数据库网络/TLS（含可能的内部 CA）和真实内部 Provider/OpenCode 验收。
