# Requirements Baseline

## Goal

完成 Stage 4C：让已校验私人 Skill 经人工发布成为团队资产，并支持成员独立安装、启用和 OpenCode 发现。

## Non-goals

- 不创建 0.2.0 等新版本，不升级、回滚、停用或撤回；留给 4D。
- 不把一个成员的 enabled 状态扩散给其他成员。
- 不改成按用户独占 OpenCode Runtime。
- 不宣称 Linux 生产就绪。

## User-visible Behavior

- 创建者对校验通过的私人版本执行明确发布。
- 团队成员浏览已发布目录，为自己安装并启用。
- 未通过、未安装或启用失败的 Skill 不进入成员 Conversation 的 OpenCode 发现面。

## Acceptance Criteria

1. 发布条件、所有权、不可变性和团队可见性由 Store/API 强制。
2. 安装包按账号原子落盘，失败补偿且无跨账号读取。
3. 启用必须经过 OpenCode 发现验证，失败保持 installed。
4. enabled Skill 在该账号所有 Conversation 工作区可发现，其他账号不可见。
5. 全部写操作具备 CSRF 和脱敏审计。
6. React、Demo、自动测试、真实 OpenCode、桌面与手机验收通过。

## Constraints

- 所有执行经过 OpenCode；工作台不直连模型 API。
- 发布必须由人确认；安装和启用分离。
- 使用现有 SQLite、共享 Worker 池和 Conversation 隔离架构。
- 不增加必须联网安装的依赖。

## Assumptions

- 4C 每个 Skill 只有一个已发布版本；版本切换属于 4D。
- Conversation 工作区是服务端受管空间，可以原子维护其 `.opencode/skills`。
- 用户已批准 full-auto 阶段推进、README、中文 commit 和 push。

## Open Questions

无阻塞问题。

## Source Request

完成 4B 后直接进入 4C，按商用多人产品设计，默认私有、人工发布、每阶段验收并推送。

## Repo Context

- Base SHA：`6c388fc`。
- Branch：`main`。
- GitHub 当前网络超时，本地领先远端 Stage 4A、4B 两个提交。
