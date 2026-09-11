# Stage 3D Attachments Implementation Log

## 2026-09-11

- 新增 SQLite/MySQL `content_attachments` 表及迁移 v8。
- Content Store 新增 Knowledge 当前版本附件记录和读取能力。
- 新增 `/api/content/knowledge/:id/attachments` 上传、下载路由；文件先进入暂存目录，校验后移动到私有存储键，数据库失败会删除落盘文件。
- Knowledge 编辑器支持在打开自己的文档后添加附件，并展示大小和摘要前缀。
- API、数据库、React 回归通过；MySQL 真库因本机未配置环境变量跳过。
- 浏览器验收：Demo 登录、知识库新建/打开文档、编辑器“添加附件”入口可见；390px 宽度横向溢出为 0。
- 新增 `backup:sqlite` / `restore:sqlite` 运维命令：数据库使用 `VACUUM INTO` 一致性快照，附件目录生成逐文件 SHA-256 manifest，恢复拒绝覆盖既有实例并先校验摘要。
- 修正恢复失败边界：所有附件在复制数据库前完成摘要预检；复制过程中任一步失败会清理新建数据库和附件目录，新增篡改附件回归测试。
- 本轮有界回归：21 项内容/附件/来源/数据库测试通过；JavaScript 语法检查 156 个文件、密钥扫描和 React/Vite 构建通过。
