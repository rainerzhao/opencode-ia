# Implementation Log

1. 在 CI 等价 MySQL 8.4 容器复现：测试重置删除了 `schema_migrations`，却遗漏 migration 13/14 的三张表，随后 migration 13 报 `ER_TABLE_EXISTS_ERROR`。
2. 失败发生在部分测试注册 `t.after` 前，未关闭的 MySQL pool 令 Node 测试进程保持运行，解释了 CI 长时间停在真库步骤。
3. `TABLES_IN_DROP_ORDER` 现按外键顺序删除字段值、草稿和字段模板；迁移重建测试包含全部三张表。
4. MySQL 驱动对 JSON 字符串标量返回裸字符串，需求仓储的 JSON 读取改为安全解析后回退原值。
5. 草稿测试先删 `requirement_drafts` 再删用户，符合草稿到 Conversation 的 `RESTRICT` 外键。
6. 定向迁移、需求仓储真库测试均通过；完整真库/TLS 套件通过 407 pass、0 fail、6 skip，75 秒。
7. 额外质量门禁已通过：`npm run build`（Vite 生产构建）、`npm run check`（204 个 JavaScript 文件）、`npm run security:scan`（无密钥发现）以及 `git diff --check`。
8. 提交 `804c9e3` 已推送到 `main`；GitHub Linux verification `35681594053` 成功通过真实 MySQL/TLS、Linux 镜像构建、容器非 root/持久目录及失败关闭入口检查。
