# Stage 3D Version Restore Requirements

## Goal

让知识和方案所有者可把指定历史版本恢复为新的当前版本，同时保留完整历史和当前发布状态。

## User-visible Behavior

- 编辑器列出可恢复的历史版本并要求人工确认。
- 恢复后立即显示历史正文，版本号递增，不覆盖旧版本。
- Knowledge 恢复历史来源和附件；方案恢复历史来源。

## Acceptance Criteria

- SQLite 与 MySQL 8.4 行为一致。
- 非所有者获得 404 语义；写操作继续受 CSRF 保护。
- HTTP 响应和审计不暴露正文、附件存储路径或密钥。
- 浏览器中知识和方案均完成 v1 → v2 → 恢复为 v3 的闭环。

## Non-goals

- 不把 Mac 验收描述为 Linux 生产上线。
- 不删除历史版本或复制物理附件文件。

## Repo Context

- 分支：`main`
- 基线：`ca94e2d053f587521d835e8e624965266425cb77`
