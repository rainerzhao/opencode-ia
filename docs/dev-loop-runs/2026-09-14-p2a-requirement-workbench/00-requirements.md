# Requirements Baseline — P2A 需求与场景工作台

## Goal

把已验收的私有需求、沟通记录、BU 与受控字段能力接入 React 工作台，使成员能在浏览器中把一次 BU 沟通记录为可继续推进的需求资产。

## Non-goals

- 不改变 OpenCode Gateway、模型 Provider、登录和权限的服务端契约。
- 不在本阶段实现对话到草稿的端到端界面（P2B），但不得阻碍其后续接入。
- 不把 Mac、本地模拟或浏览器验收表述为公司生产上线。

## User-visible Behavior

- 左侧主导航提供“需求与场景”入口；首页从营销式卡片改为个人待推进工作概览。
- 需求页支持按关键字、BU、状态筛选和分页加载自己的需求。
- 成员可以新建与编辑自己的私有需求：标题、BU、场景、描述、状态与当前受控字段值。
- 需求详情展示原始沟通时间线，并可记录 IIM、电话、会议或手工沟通；浏览器本地时间必须转为 API 要求的 ISO 时间。
- 页面明确展示“默认私有”，不显示其他成员私有正文、字段值或沟通内容。
- 桌面为需求流、详情、行动区的高信息密度布局；窄屏可纵向使用且无横向溢出。

## Acceptance Criteria

1. 静态渲染测试能证明导航、筛选、创建、编辑、沟通录入与私有状态可见。
2. API 客户端请求路径和写入方法与既有 Requirement Router 一致，写请求继续走现有 CSRF 保护。
3. 通过浏览器完成：登录、创建私有需求、添加沟通、筛选并重新打开详情。
4. 桌面与 390px 窄屏检查不存在页面横向溢出，关键操作可达。
5. 既有聊天、知识、方案与 Skill 页面持续构建和测试通过。

## Constraints

- 复用现有 React/Vite 与 `request()` API 边界；不引入前端状态库。
- 所有用户提交仍由服务端验证；前端不绕过 owner-only API。
- 使用编辑部式、克制高密度视觉：暖白底、深墨文字、深青绿行动色；不使用紫色渐变或通用 AI 控制台外观。

## Assumptions

- 当前成员只处理自己的需求，管理员字段模板维护继续留在后台入口。
- P2A 的“今日待推进”由私有需求列表中的 `draft`、`clarifying`、`in_progress` 聚合得出，不创造新的业务状态。
- 用户此前已确认以需求资产为中心的三栏工作台方向，可直接进入实施。

## Source Request

活跃 App Goal；用户已确认的工作台产品方向与 P2A 阶段定义。

## Repo Context

- 需求 API：`src/modules/requirements/routes.js`
- 输入契约：`src/requirements/requirement-input.js`
- Web 壳：`apps/web/src/shell/WorkbenchShell.jsx`
- 现有页面：`apps/web/src/features/*`
