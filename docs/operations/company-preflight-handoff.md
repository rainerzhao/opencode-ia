# 公司内网预发布交接清单

本清单将当前仓库的本机证据与必须在公司环境取得的证据分开。满足本机检查不代表允许开放访问。

## 已在仓库或 Mac 验证

| 项目 | 当前证据 | 边界 |
| --- | --- | --- |
| 业务数据层 | MySQL-only 生产组合、迁移、TLS/附件恢复相关回归 | 不证明公司云数据库网络、账号或 CA 可用 |
| Runtime 边界 | 常驻 OpenCode Worker、私有 Conversation、队列、恢复测试 | 不证明公司 Provider 的质量、限流或长期稳定性 |
| 多人调度 | 20 账号、20 WebSocket、60 Conversation、180 模拟任务 | 模拟 Worker，不是模型吞吐 SLA |
| 部署门禁 | 非 root、外部 MySQL、Secure Cookie、Runtime 路径、Provider 文件检查 | 尚未在公司 Linux 主机运行 |
| 产品闭环 | 需求、沟通、私有内容、草稿确认、资产关联、会话资料库 | 隔离 Demo，不是生产验收 |

## 预发布机必须由平台/运维提供

1. 非 root 服务账号、受限目录和 HTTPS 入口；服务账号能读取 `/etc/opencode-workbench/opencode.json`，文件为 0600。
2. 公司云 MySQL URL、服务账号、CA 文件和到数据库的网络放行；应用不具备 SQLite fallback。
3. 公司内部 OpenAI 兼容 Provider 的 base URL、模型授权和凭证注入方式；凭证不得写入仓库、Compose、systemd unit 或命令行。
4. Nginx 证书、内网 DNS/访问策略、备份落盘位置和恢复演练窗口。

## 在公司 Linux 依次执行

```bash
npm run preflight:production
npm run preflight:opencode
npm run start:production
```

门禁全部通过后，按 [内部 Provider 联调清单](internal-provider.md) 运行：两个账号的多会话短测、20×3×3 真实模型任务、取消/断线、Runtime 与 MySQL 故障恢复、备份恢复和升级回滚。每一步记录 Git SHA、OpenCode 版本、迁移版本、耗时和安全错误码摘要；不记录 Prompt、响应正文、Cookie 或密钥。

## 开放访问的否决条件

- 任一门禁未通过、Provider 出现未解释 401/403/429、或审计/日志出现正文或密钥。
- 真实任务有跨账号可读、跨 Conversation 串话、恢复后重复执行、或备份无法恢复附件。
- 20 用户真实验收、故障演练、回滚演练和安全复核尚无记录。

满足这些条件前，状态只能是“预发布待验收”，不是“生产已上线”。
