# Stage 5 Linux 部署前置 Implementation Log

## 2026-09-11

- 新增 `/healthz` 无认证探活，返回数据库和 Gateway 汇总状态，不返回账号、任务正文、会话或模型配置。
- 新增 `deploy/Dockerfile`、`deploy/compose.intranet.yaml`、systemd 单元、Nginx HTTPS/WebSocket 代理和 Nginx `map` 片段。
- 新增内网部署运行手册，说明非 root 目录、受保护环境文件、MySQL 迁移、OpenCode 凭证边界及恢复/回滚顺序。
- 新增部署契约测试并通过 `docker compose config --quiet`。
- 新增 `backup:mysql` / `restore:mysql`：临时文件原子备份、SHA-256 清单、`MYSQL_PWD` 传密和恢复显式确认；SQLite 与 MySQL 备份边界写入运行手册。
