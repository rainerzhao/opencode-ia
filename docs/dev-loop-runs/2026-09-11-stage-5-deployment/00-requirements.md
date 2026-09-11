# Stage 5 Linux 部署前置 Requirements

## Goal

提供可审阅、无密钥的 Linux 内网预发布运行契约：非 root 服务、MySQL 8.4、OpenCode Runtime、健康检查、HTTPS/WebSocket 反向代理和可回滚操作说明。

## Non-goals

- 不宣称已在公司 Linux 服务器上线。
- 不把 Provider 密钥、TLS 私钥或内部域名写入仓库。
- 不在工作台内实现第二套模型 Runtime。

## Acceptance Criteria

1. Compose、Dockerfile、systemd、Nginx 模板可静态校验。
2. `/healthz` 可用于无认证探活且不泄露私有业务数据。
3. 文档明确 MySQL-only 与 SQLite Demo 的边界、升级/回滚和人工验收步骤。
