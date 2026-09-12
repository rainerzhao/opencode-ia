# Stage 3D Version Restore Implementation Log

- SQLite/MySQL Content Store 新增知识与方案历史恢复；恢复结果是新的不可变当前版本。
- Knowledge 保存、发布、撤回与恢复继承来源及附件；方案恢复对应历史来源。
- 数据库迁移 v9 移除附件存储键唯一约束，保留普通索引，允许多个版本安全引用同一物理文件。
- 新增 `POST /api/content/knowledge/:id/restore` 与 `POST /api/content/solutions/:id/restore`，审计记录 `restoredFromVersion`，不记录正文或存储路径。
- React 编辑器增加恢复按钮与确认弹窗。
- 浏览器首次验收发现恢复后版本已更新但非受控正文仍显示旧值；定位到 `defaultValue` 不会在同一表单实例更新，以 `内容 ID:版本号` 作为表单 key 后复验通过。
- 保留已有未跟踪用户文件，不纳入本阶段提交。
