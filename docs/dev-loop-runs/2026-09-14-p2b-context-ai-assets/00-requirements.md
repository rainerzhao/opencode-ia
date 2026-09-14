# Requirements Baseline — P2B 上下文 AI 与关联资产

## Goal

把 P1B/P1C 已有的私有关联、Conversation 历史和 OpenCode 需求草稿能力放进工作台，形成“沟通事实 → AI 草稿 → 人工确认 → 私有需求 / 方案 / 知识”的可见闭环。

## User-visible Behavior

- 成员能从自己的某个 Conversation 明确选择事件范围，请求经 OpenCode Gateway 生成需求草稿。
- 草稿状态可轮询；草稿只显示结构化结论、待澄清项和引用范围，不泄露其它 Conversation 内容。
- 成员可以选择 BU、修订草稿后确认创建私有需求，或拒绝草稿；AI 绝不自动创建/发布。
- 已有需求详情能链接自己的 Conversation、知识或方案版本，并显示资源类型/标题；关联不会扩大内容读取权限。

## Acceptance Criteria

1. UI 静态测试覆盖草稿请求、状态、确认/拒绝、关联资产入口与私有提示。
2. 浏览器端到端至少跑通一个隔离 Demo：Conversation → 草稿请求/失败可解释或模拟完成 → 人工确认；关联资产可查看。
3. 所有模型工作仍由现有 Gateway API 发起；前端不新增 Provider 直连。
4. 桌面和窄屏无横向溢出；P2A 不回归。

## Constraints

- 只使用既有 `/api/requirements/drafts`、`/api/requirements/:id/links`、Conversation 与内容 API；如必须增加 API，先补服务端授权测试。
- 不将 Conversation 原文复制到草稿/审计；UI 不在浏览器持久化私有正文。
- 在真实公司 Provider、云 MySQL 和 Linux 前，不声称生产验收。
