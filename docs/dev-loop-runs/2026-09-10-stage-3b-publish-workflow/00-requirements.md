# Requirements Baseline

## Goal

将 Stage 3A 的版本化内容 Store 接入受认证 API 与现有 React 界面，使成员能够保存私有知识/方案草稿，并通过一次明确、受审计的动作发布到团队；发布者或管理员可撤回团队内容。

## Non-goals

- 不自动从 Conversation 发布内容，不调用模型，也不实现文件附件解析、导入导出或备份恢复。
- 不移除旧文件数据；本阶段仅将新建/编辑工作流迁移到 Store。
- 不允许客户端任意伪造来源引用；Conversation 转换留给 Stage 3C。

## Acceptance Criteria

1. `POST/PATCH/GET/search/publish/withdraw` 内容 API 必须经过已有认证与 CSRF 链路，所有写入记录安全审计元数据。
2. 成员只能读写自己的私有草稿；非所有者获取私有 ID 返回 404；成员只能见到已发布的团队内容。
3. 发布与撤回均产生新的不可变版本；撤回后团队搜索和详情不再可见，所有者仍可编辑。
4. 知识和方案 React 页面使用新 API，新建内容默认私有且界面明确展示状态；发布/撤回需要页面内二次确认。
5. 完整测试、浏览器级 UI 验收、构建、语法、密钥和差异检查通过后，用中文 commit 推送 main。

## Constraints

- 默认私有；“团队”可见仅等价于 `visibility=team AND status=published`。
- 审计只记录 ID、版本、状态、可见性和请求 ID，绝不记录正文、描述或来源正文。
- 所有模型/Agent/Skill/Tool 仍只经 OpenCode；本阶段没有模型调用。
- Mac 验收不可表述为 Linux 生产就绪。

## Assumptions

- Stage 3B 中管理员可执行元数据治理和发布/撤回；私人正文只在明确详情读取中返回。
- 旧 `/api/knowledge/*` 与 `/api/solutions` 暂保留给历史文件型内容，新的 React 页面只调用 `/api/content/*`。
