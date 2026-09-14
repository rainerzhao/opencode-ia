# Requirements Baseline — P2C 会话资料库

## Goal

让每位成员在不改变私有隔离的前提下，搜索、分页查看、归档和恢复自己的持久 Conversation，并在 React 工作台中完成日常操作。

## User-visible Behavior

- “我的对话”支持标题搜索、每页加载、当前/已归档切换。
- 成员可在当前对话中归档；归档只影响自己的 Conversation，不能再提交新任务。
- 成员可从已归档列表恢复 Conversation；恢复后可重新打开并继续使用同一持久上下文。
- 任何列表、搜索、归档或恢复均不扩大管理员或其他成员的内容访问权。

## Acceptance Criteria

1. SQLite 和 MySQL Store 都支持 owner+status+标题查询、分页和恢复。
2. REST 对 `status`、`q`、`limit`、`offset` 严格校验；恢复有 CSRF 与审计，跨账号为 404。
3. React 页面能搜索、翻页、切换已归档、归档/恢复；窄屏无横向溢出。
4. 不让搜索词、标题或消息正文进入审计元数据。
5. 不将本机 Demo 当作公司生产验收。

## Constraints

- 只处理 Conversation 元数据；历史正文仍通过 owner-only events API 读取。
- 保留 Conversation → OpenCode Session 映射，恢复不是复制或公开内容。
- 不纳入现有无关未跟踪文件。
