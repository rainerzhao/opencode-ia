# Stage 3D Attachments Requirements

## Goal

让版本化 Knowledge 支持有主、可校验、默认私有的附件，并为后续解析、导入导出和备份恢复提供稳定元数据。

## Implemented slice

- Knowledge 当前版本附件元数据进入 Content Store；文件落盘使用账号/文档/随机 ID 组成的私有 storage key。
- 受 CSRF 保护的上传和下载 API；只允许内容所有者写入，已发布内容按内容可见性读取。
- 记录原始文件名、媒体类型、字节数、SHA-256 和创建时间；50 MiB 上限、扩展名白名单和路径边界。

## Remaining

附件内容解析、导入导出包、备份恢复、版本差异和真实 MySQL 回归尚未完成。
