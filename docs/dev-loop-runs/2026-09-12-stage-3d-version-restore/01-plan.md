# Stage 3D Version Restore Plan

1. 为 SQLite/MySQL Store 增加新版本式恢复，并继承来源与 Knowledge 附件。
2. 通过迁移允许多个版本记录引用同一受保护物理附件。
3. 增加受认证、CSRF 保护的 REST 接口和脱敏审计元数据。
4. 在知识与方案编辑器增加历史恢复和确认交互。
5. 运行 Store、API、UI、迁移与真实 MySQL 回归，再做浏览器闭环。
6. 更新产品 README 与路线图，明确 Stage 3 Mac 验收和 Stage 5 Linux 边界。

风险：迁移兼容性、附件引用共享、恢复后非受控表单内容刷新、历史来源隐私。
