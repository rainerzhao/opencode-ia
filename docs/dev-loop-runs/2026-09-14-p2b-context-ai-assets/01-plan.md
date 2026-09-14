# P2B 上下文 AI 与关联资产 Implementation Plan

**Goal:** 在不绕开 OpenCode 和私有边界的前提下，把 Conversation 生成草稿与需求资产关联接入 React 工作台。

**Architecture:** 将草稿请求 UI 放入 ChatPage（拥有 Conversation 与事件序列），将草稿状态/确认与关联资源放入 RequirementsPage（拥有 BU、字段模板和需求详情）。两个页面只通过既有 REST/Gateway 边界交互，不共享私有内容到全局状态。

## Task Order

1. 盘点 Conversation 事件序列和现有草稿 API 的浏览器可调用契约；先为草稿组件写失败测试。
2. 在 ChatPage 增加“生成需求草稿”面板：选定当前 Conversation 的可用事件范围、请求、轮询与失败说明。
3. 在 RequirementsPage 增加草稿收件箱和人工确认编辑器；确认只调用既有 confirm API，拒绝只调用 reject API。
4. 增加关联资产面板：使用已存在的 link routes，初期按 Conversation/Knowledge/Solution 的私有可见列表选择资源。
5. 完成隔离 Demo 浏览器验收、README/ROADMAP/PRODUCT_GOAL、测试、安全扫描、中文提交和推送。

## Risks

- 草稿的真实 Provider 输出需要严格 JSON；Demo 的通用回复不满足该契约，验收必须明确为失败可解释或提供仅限测试的结构化 Gateway fixture，不能伪称真实模型验收。
- 事件序列是 Gateway 协议数据，不是 UI 消息数组长度；范围选择只能使用服务端确认过的 sequence。
