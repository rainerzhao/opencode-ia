# Implementation Plan

## Architecture Summary

保持现有 React 数据流，仅在 feature-owned CSS 与语义标记层修正布局。资产空态继续调用原有创建流程；Skill、会话与发布操作不改变请求协议。

## Tasks

1. 真实 Demo 遍历七个工作区，留存修复前证据并分级问题。
2. 为资产首次操作与 Skill 语义工作区补失败契约。
3. 修复 AI 会话栏隐式网格、方案/知识空态和 Skill 双栏布局。
4. 在填充态创建需求、会话、方案、知识和 Skill 草稿。
5. 完成 1440px/1024px、键盘焦点、全量自动化和文档验收。

## Expected Files

- `apps/web/src/features/chat/chat.css`
- `apps/web/src/features/assets/assets.css`
- `apps/web/src/features/skills/skills.css`
- `apps/web/src/features/{solutions,knowledge,skills}/*.jsx`
- `apps/web/src/styles.css`
- `test/ui/react-features.test.js`
- `README.md`, `docs/PRODUCT_GOAL.md`, `docs/ROADMAP.md`

## Test Strategy

- RED/GREEN：聚焦 React SSR 契约。
- 浏览器：隔离 Demo 1440×1000、1024×900，空态与填充态。
- 最终门禁：`npm test`、`npm run build`、`npm run check`、`npm run security:scan`、`git diff --check`。

## Risks and Rulings

- Ruling：不为视觉修正改业务接口，降低回归风险。
- Ruling：1024px 下对话结果动作横跨工作区并等宽排列，避免塞入 220px 会话栏。
- Ruling：Skill 操作栏保持正常文档流，不使用会遮挡字段的 sticky 定位。
