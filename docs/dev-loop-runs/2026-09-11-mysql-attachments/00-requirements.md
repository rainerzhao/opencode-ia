# Requirements Baseline

## Goal

让 MySQL 生产备份覆盖 Knowledge 私有附件，并保持 SQL dump 与附件文件的独立校验、原子落盘和安全恢复边界。

## Non-goals

- 不改变知识附件 API、权限或存储键格式。
- 不把备份脚本误写成 Linux 生产灾备已完成。
- 不在本阶段实现知识包导入或真实 MySQL 线上恢复演练。

## User-visible Behavior

- `backup:mysql` 可通过 `--attachments <dir>` 备份附件 sidecar。
- `restore:mysql` 可通过 `--attachments <dir>` 恢复附件到新目录。
- SQL 清单与附件清单分开保存；恢复前校验 SHA-256、大小、相对路径和符号链接。

## Acceptance Criteria

1. 附件按相对路径复制并生成逐文件 SHA-256 manifest。
2. 备份和恢复拒绝符号链接、路径逃逸和摘要篡改。
3. 任何失败都不会留下 partial/output 产物或覆盖既有恢复目录。
4. 原有无附件 SQL 备份接口和清单格式保持兼容。

## Constraints

- Provider/API Key 不进入备份清单、参数或日志。
- 备份密码仅通过 `MYSQL_PWD` 传递。
- 中文提交并推送 `main`；保留其他未跟踪研发文档。
