# Stage 5D1 Checked Startup Requirements

## Goal

让 Docker 和 systemd 生产入口在打开服务端口前强制执行生产配置与 OpenCode Provider 门禁，并保证容器数据目录可由非 root 服务账号写入。

## Acceptance Criteria

- 两项门禁全部通过后才调用应用启动；任一失败不启动服务。
- Provider 配置为 `0600` 且归服务账号所有。
- Docker/systemd 默认使用受检入口，不依赖人工记忆执行 preflight。
- Docker build context 不包含 `.env`、Git、运行数据库、日志或本机交接材料。
- 生产 Compose 不创建 MySQL 服务、root 密码或数据库数据卷，只接受必填的公司云 MySQL 连接串。
- Compose 能以无密钥占位配置完成静态解析；Linux/amd64 镜像完成实际构建后才关闭本阶段。

## Non-goals

- 不伪造公司内部 Provider 联调结果。
- 不把 Mac Docker 验收写成公司 Linux 真机上线。

## Baseline

`f6f7e61898b16e67698ba272f0482bd4e5b6ced6`
