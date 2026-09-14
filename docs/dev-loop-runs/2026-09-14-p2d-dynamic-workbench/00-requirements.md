# Requirements Baseline

## Goal

将“工作台首页”从静态产品介绍改为登录成员每天可使用的私有行动入口，汇总已有需求、Conversation、方案和知识，不创建第二套业务数据或模型调用路径。

## Non-goals

- 不增加新的业务表、聚合 API、模型调用或自动发布动作。
- 不在首页展示其他成员资产、Conversation 标题、沟通正文、Prompt、响应或审计正文。
- 不以首页统计证明生产容量、真实 Provider 或 Linux 部署验收。

## User-visible Behavior

- 成员打开首页后，看到自己需要推进的需求数量、待澄清需求数量、进行中的会话数量，以及可继续沉淀的私有内容数量。
- 每个统计卡都有明确的下一步按钮，进入既有需求、AI 对话、方案或知识页面。
- 首次加载、无数据和局部读取失败都有可理解的状态；局部失败不阻断已有首页导航。
- 首页继续说明默认私有与 OpenCode Runtime 的职责，但不再是不能操作的静态宣传页。

## Acceptance Criteria

1. 首页仅通过现有受认证 owner-scoped API 读取用户自己的列表数据。
2. 汇总逻辑只使用状态、数量和时间等元数据；页面不渲染私人标题或正文。
3. “待推进”包含 `draft`、`clarifying`、`in_progress` 需求；“待澄清”只包含 `clarifying`。
4. active Conversation、私有方案/知识草稿被独立计数；每张卡可进入相应工作区。
5. 加载、空数据、读取失败均有可访问文字，且不破坏主导航。
6. React 静态渲染测试覆盖指标、隐私边界和操作入口；浏览器验收桌面与 390px 窄屏无横向溢出。
7. README 与路线图记录 P2D 的真实验收范围，提交为中文 Git commit 并推送 `main`。

## Constraints

- OpenCode 是唯一 Agent Runtime；首页不得直接调用 Provider。
- 默认私有、显式共享、账号身份与审计边界保持不变。
- 沿用 React/Vite、既有 `request` 客户端和编辑部式资料架视觉语言。
- 不把模拟或 Mac 浏览器证据称为生产验收。

## Assumptions

- 已有 `/api/requirements`、`/api/conversations`、`/api/content/solutions`、`/api/content/knowledge` 均按当前登录用户收敛可见内容。
- 首页只需近期/状态概览，不需要跨资产全文搜索或新的分页行为。

## Open Questions

无。该范围直接落实已确认的产品 Goal，不改变数据模型、权限策略或部署架构。

## Source Request

持续将项目建设为面向集团 BU 的云解决方案工作台，重构我的工作台、需求与场景、方案资产、团队知识库四类产品页面，并在每个可验收阶段更新 README、验证、中文提交并推送。

## Repo Context

- `apps/web/src/features/home/HomePage.jsx` 当前是静态引导页。
- `apps/web/src/shell/WorkbenchShell.jsx` 已以 `go(pageId)` 切换既有工作区。
- `apps/web/src/api/client.js` 强制同源认证请求，并为写请求附加 CSRF；P2D 仅使用 GET。
- `test/ui/react-features.test.js` 使用 Vite SSR 静态渲染验证前端契约。
