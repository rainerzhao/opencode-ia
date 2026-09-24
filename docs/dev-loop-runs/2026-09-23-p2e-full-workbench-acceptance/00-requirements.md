# Requirements Baseline

## Goal

完成 P2E 桌面工作台总验收，并修复真实浏览器中仍然存在的低质量布局：AI 对话栏异常拉伸、Skill 编辑器错位、资产空态缺少使用路径，以及 1024px 对话结果区过窄。

## Non-goals

- 不改变 API、权限、WebSocket、数据库或 OpenCode Runtime 契约。
- 不新增手机和平板布局。
- 不把 Mac、Demo 或模拟回复写成公司生产验收。

## User-visible Behavior

- 七个工作区使用同一桌面壳层和视觉语言。
- AI 搜索、会话列表、消息与结果动作保持稳定对齐。
- Skill 在 1440px 使用资产导航与编辑器双栏，在 1024px 使用可读单栏。
- 方案和知识空态解释“私有草稿 → 人工确认 → 团队发布”，并提供首次操作。

## Acceptance Criteria

- 1440×1000 覆盖七个工作区；1024×900 覆盖首页、需求、AI、Skill 和管理。
- 页面无横向溢出，主要控件不被遮挡，长表单操作顺序稳定。
- 填充态真实创建私人需求、会话、方案、知识和 Skill 草稿。
- 键盘焦点为可见 2px 信号色轮廓。
- 自动化、构建、语法检查、密钥扫描和 diff 检查通过。

## Constraints

- 默认私有和 owner-scoped 边界不变。
- 所有模型、Agent、Skill 与 Tool 仍经 OpenCode。
- 只提交本次相关文件，避开既有未跟踪材料。

## Assumptions

- 已确认的 P2E 规格与实施计划继续有效，本轮属于总验收和缺陷修正。
- 隔离 Demo 可用于产品交互和布局证据，但不证明生产能力。

## Open Questions

无阻断问题。

## Source Request

用户指出现有前端过于 low、框图大小失控、没有完整使用体验，并要求按既有 Goal 连续开发、验证、更新 README、中文提交并推送。

## Repo Context

- 基线提交：`e75505e`
- 分支：`main`
- 规格：`docs/superpowers/specs/2026-09-22-p2e-desktop-workbench-design.md`
- 计划：`docs/superpowers/plans/2026-09-22-p2e-desktop-workbench.md`
