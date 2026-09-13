# 内联审查

APPROVED；未使用子代理。

- mysql2 必须显式开启 verifyIdentity；其 IP 字面量路径与 DNS 路径不同，mysqls 只接受 DNS 端点，防止宣称校验却遗漏 IP 主机身份。
- 不接受 URL 查询参数静默覆盖 TLS；CA 必须绝对路径、可读、有限大小的 PEM 包。格式校验不代替握手时的信任与有效期校验。
- MySQL 原生客户端使用 VERIFY_IDENTITY、TCP 与显式 CA；两种客户端均保留真实握手验证。
- 凭证仍由环境进入子进程，不进入备份清单。旧 --url 保持兼容但运维文档不再推荐。
- Docker 只用于本机自动验收的临时数据库，生产 Compose 仍连接公司云数据库。
