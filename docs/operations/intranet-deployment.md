# 内网部署运行手册（预发布模板）

这组模板用于公司内网预发布，不包含任何真实密码、证书或 Provider 配置。OpenCode 是唯一模型与工具 Runtime；工作台只通过 `WORKBENCH_DATABASE_URL` 连接 MySQL，Provider 凭证仍由 OpenCode 的受保护配置管理。

## Compose 方式

1. 在受保护的环境文件中填写 `WORKBENCH_MYSQL_DATABASE`、`WORKBENCH_MYSQL_USER`、`WORKBENCH_MYSQL_PASSWORD`、`WORKBENCH_MYSQL_ROOT_PASSWORD`、`OPENCODE_INSTALL_ROOT` 和 `OPENCODE_VERIFIED_VERSION`。
2. 将 `deploy/compose.intranet.yaml` 的 `ai-workbench.intra.example`、TLS 路径、数据卷和 OpenCode 安装路径替换为内网值。
3. 先启动并观察数据库健康：`docker compose -f deploy/compose.intranet.yaml up -d mysql`。
4. 再启动工作台：`docker compose -f deploy/compose.intranet.yaml up -d workbench`，检查 `curl -fsS http://127.0.0.1:3000/healthz`。
5. 首次初始化管理员使用受控终端执行 `npm run admin:create`；密码不写入命令参数、镜像或 Git。

## systemd + Nginx 方式

- 创建非 root `opencode` 用户和 `/var/lib/opencode-workbench`，目录仅授予该用户读写。
- 将 `deploy/systemd/opencode-workbench.service` 安装到 `/etc/systemd/system/`，将环境变量放到权限为 `0600` 的 `/etc/opencode-workbench/workbench.env`。
- 将 `deploy/nginx/nginx.conf.snippet` 放入 Nginx `http {}`，再按内网域名和证书调整 `opencode-workbench.conf`。
- 启动顺序：MySQL 健康 → `systemctl start opencode-workbench` → 检查 `/healthz` → 通过 HTTPS 登录验收 WebSocket。

## 升级、回滚和恢复

- 发布前保存镜像版本、Git SHA、迁移版本和配置摘要（不含秘密）。
- 先执行 `npm run backup:mysql -- --url "$WORKBENCH_DATABASE_URL" --output /var/backups/opencode-workbench-<timestamp>.sql`，并使用 `npm run restore:mysql -- --url "$RESTORE_DATABASE_URL" --input <backup>.sql --confirm` 恢复到隔离新实例验证，再执行应用升级；迁移失败保持旧版本，不手工修改 `schema_migrations`。
- MySQL 备份脚本通过 `MYSQL_PWD` 传递密码，不会把密码放入进程参数；备份旁边的 `.manifest.json` 用于恢复前摘要校验。
- SQLite `backup:sqlite/restore:sqlite` 仅用于 Mac Demo 过渡，不作为 MySQL 生产备份方案。
- MySQL 生产备份、恢复演练、日志轮转、容量和故障注入仍需在公司 Linux 预发布环境完成后，才能开放团队访问。
