# Requirements Baseline

## Goal

为 Linux 内网生产启动增加明确、可复现且不泄露秘密的配置门禁。

## Acceptance Criteria

1. 只接受 production、MySQL URL、Secure Cookie 和非 root 运行。
2. 明确拒绝 SQLite 路径混用、无效 OpenCode 可执行文件和超出 Worker 池容量的并发。
3. 命令输出不包含数据库 URL、密码或 Provider 配置。
