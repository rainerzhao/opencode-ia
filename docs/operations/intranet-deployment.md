# 内网部署运行手册（预发布模板）

这组模板用于公司内网预发布，不包含任何真实密码、证书或 Provider 配置。OpenCode 是唯一模型与工具 Runtime；工作台只通过 `WORKBENCH_DATABASE_URL` 连接公司云 MySQL，Provider 凭证仍由 OpenCode 的受保护配置管理。生产 Compose 不创建 MySQL，数据库实例、高可用、自动备份和基础监控由公司的云数据库平台负责。

## 云数据库前置条件

- 申请公司云 MySQL 8.4 实例、独立数据库和最小权限应用账号；不要使用 root 或管理员账号连接工作台。
- 数据库必须提供 `utf8mb4`、UTC 时区、启用的 `ngram` parser 和 `ngram_token_size=2`。应用启动时仍会校验版本与这些能力，并在迁移锁保护下执行 schema migration；不满足时拒绝启动。
- 将 Linux 预发布机或容器网段加入数据库访问白名单，并先从部署主机验证 DNS、端口和 TLS 证书链。
- `mysqls://` 强制校验证书链和主机名，连接地址必须使用证书覆盖的 DNS 域名；当前驱动对 IP 字面量的身份校验路径不同，应用明确拒绝 TLS IP 地址。URL 不支持查询参数或片段。`mysql://` 保留给明确允许非 TLS 的开发/受控环境，CA 配置不得与它混用。
- 如公司云数据库使用内部 CA，设置 `MYSQL_SSL_CA_FILE` 为可读 PEM 证书包的绝对路径；应用、管理员初始化和备份/恢复都读取它。缺失或损坏的 CA 会阻止连接。默认 CA 使用各客户端的系统信任库；如需一致的信任链，应给应用和运维终端提供相同 CA 包。不得通过关闭证书校验绕过 TLS 问题。
- 由数据库平台配置高可用、自动快照、保留周期、告警与恢复演练。应用仓库不保存数据库密码。

## Compose 方式

1. 在权限为 `0600` 的受保护环境文件中填写完整的 `WORKBENCH_DATABASE_URL`、`OPENCODE_INSTALL_ROOT`、`OPENCODE_CONFIG_FILE_HOST` 和 `OPENCODE_VERIFIED_VERSION`。生产优先使用云数据库提供的 TLS 连接地址（`mysqls://`）；不要把连接串写入 Compose、镜像或 Git。Provider 配置须为 `0600`，并由容器内 `node` 用户对应的主机 UID（默认 `1000`）拥有，否则启动门禁会拒绝运行。
2. 将 `deploy/compose.intranet.yaml` 的数据卷和 OpenCode 安装路径替换为内网值；Nginx 域名和 TLS 路径在独立配置中调整。
3. 从部署主机确认公司云 MySQL 健康且网络可达，再运行 `docker compose -f deploy/compose.intranet.yaml config --quiet` 检查必填配置。
4. 启动唯一的工作台服务：`docker compose -f deploy/compose.intranet.yaml up -d workbench`，检查 `curl -fsS http://127.0.0.1:3000/healthz`。
5. 首次初始化管理员在受控终端执行 `docker compose -f deploy/compose.intranet.yaml exec workbench npm run admin:create -- --username admin --display-name 管理员`。容器使用与服务相同的 `WORKBENCH_DATABASE_URL`，通过能力检查和迁移后将首位管理员写入公司云 MySQL；密码按提示输入两次。已有账号时拒绝重复初始化，并发初始化由数据库锁串行处理。若服务尚未启动，也可用 `docker compose -f deploy/compose.intranet.yaml run --rm --no-deps workbench npm run admin:create -- --username admin --display-name 管理员`。
6. 镜像入口使用 `npm run start:production` 的同一受检启动器，启动服务前强制执行生产配置和 Provider 门禁；任一检查失败都不会打开 HTTP 端口。运维人员仍可单独执行 `npm run preflight:production` 和 `npm run preflight:opencode` 进行预检。

使用内部 CA 时，在受保护环境中设置 `MYSQL_SSL_CA_FILE_HOST` 为宿主机 CA 文件的绝对路径。所有 Compose 操作同时传入两个文件：`docker compose -f deploy/compose.intranet.yaml -f deploy/compose.mysql-tls.yaml up -d workbench`（`exec`、`run`、`config` 等操作同样添加该覆盖文件）。覆盖文件将 CA 只读挂载到容器并设置 `MYSQL_SSL_CA_FILE`；主机文件不存在时不会自动创建目录。

## systemd + Nginx 方式

- 创建非 root `opencode` 用户和 `/var/lib/opencode-workbench`，目录仅授予该用户读写；OpenCode 配置须为 `0600` 且归该用户所有。
- 将 `deploy/systemd/opencode-workbench.service` 安装到 `/etc/systemd/system/`，将环境变量放到权限为 `0600` 的 `/etc/opencode-workbench/workbench.env`。
- 首次管理员初始化须在 `opencode` 服务账号的受控终端内，加载与 systemd 相同的环境配置后执行 `npm run admin:create -- --username admin --display-name 管理员`。生产模式不允许缺少 `WORKBENCH_DATABASE_URL`，也不允许同时设置 `DATABASE_PATH`。
- 将 `deploy/nginx/nginx.conf.snippet` 放入 Nginx `http {}`，再按内网域名和证书调整 `opencode-workbench.conf`。
- 启动顺序：确认公司云 MySQL 健康且网络可达 → `systemctl start opencode-workbench` → 受检启动器自动执行两项门禁和数据库能力/迁移检查 → 检查 `/healthz` → 通过 HTTPS 登录验收 WebSocket。
- Prometheus 可抓取内网主机的 `/metrics`；该端点只返回聚合指标，不含账号、会话正文、Provider 或密钥。

## 升级、回滚和恢复

- 发布前保存镜像版本、Git SHA、迁移版本和配置摘要（不含秘密）。
- 公司云数据库的自动快照、PITR/高可用和保留策略是生产主备份机制；发布前必须确认最近备份可用，并恢复到隔离实例演练。仓库内 `npm run backup:mysql` / `restore:mysql` 只作为跨实例迁移和独立校验手段，不替代云数据库灾备。
- 如需应用级导出，在已设置受保护环境的终端执行 `npm run backup:mysql -- --output /var/backups/opencode-workbench-<timestamp>.sql --attachments /var/lib/opencode-workbench/content-attachments`。恢复前在环境中将 `WORKBENCH_DATABASE_URL` 设置为隔离目标库，必要时同步更换 CA，再运行 `npm run restore:mysql -- --input <backup>.sql --attachments <restore-attachments> --confirm`。迁移失败保持旧版本，不手工修改 `schema_migrations`。
- 运维终端须提供 MySQL 8.4 `mysql` / `mysqldump` 客户端（应用镜像未捆绑它们）。脚本从环境读取数据库连接串，通过 `MYSQL_PWD` 传递密码；不要使用会将连接串放入进程列表的 `--url` 参数。TLS URL 会向两个客户端传递 `--ssl-mode=VERIFY_IDENTITY` 和可选 CA 路径，强制 TCP。SQL dump 的 `.manifest.json` 与附件 sidecar 的 `.attachments.manifest.json` 分开保存并在恢复前逐项校验摘要。附件目录拒绝符号链接，恢复写入新目录并拒绝覆盖已有目录。
- SQLite `backup:sqlite/restore:sqlite` 仅用于 Mac Demo 过渡，不作为 MySQL 生产备份方案。
- MySQL 生产备份、恢复演练、日志轮转、容量和故障注入仍需在公司 Linux 预发布环境完成后，才能开放团队访问。
