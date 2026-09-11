# Stage 3D Attachments Implementation Log

## 2026-09-11

- 新增 SQLite/MySQL `content_attachments` 表及迁移 v8。
- Content Store 新增 Knowledge 当前版本附件记录和读取能力。
- 新增 `/api/content/knowledge/:id/attachments` 上传、下载路由；文件先进入暂存目录，校验后移动到私有存储键，数据库失败会删除落盘文件。
- Knowledge 编辑器支持在打开自己的文档后添加附件，并展示大小和摘要前缀。
- API、数据库、React 回归通过；MySQL 真库因本机未配置环境变量跳过。
