# Stage 4D Skill 版本治理设计

## 版本状态与可见性

`skills` 是稳定的团队资产，`skill_versions` 是不可变包。首个发布版本为活动发布版本（`published`）。创建后继版本只增加一条 `draft` 记录、复制已发布包和文件，并保持它只对创建者/管理员可编辑可见；不会替换团队正在使用的版本。

后继草稿通过既有 4B 验证并发布时，原活动版本置为 `retired`，新版本置为 `published`。`retired` 保留供已安装成员继续使用或明确回滚，但新的普通安装只解析 `published` 活动版本。成员目录、团队目录与私有草稿的查询必须按调用者/用途解析版本，禁止用“最新创建行”代替“当前公开版本”。

版本号使用 `major.minor.patch`；Stage 4D 自动把当前最大版本的 minor 加一、patch 归零。例如 `0.1.0` 后继为 `0.2.0`。

## 成员安装选择

每位成员每个 Skill 有一条 `skill_installations`。安装首次选择活动发布版本。升级选择当前活动版本，回滚只能选择同一 Skill 保留的 `retired` 版本。两者都会：

1. 验证目标版本仍可供该用户选择；
2. 原子写入该用户受管目录；
3. 在一个数据库事务内更新 `version_id` 并将状态设为 `installed`；
4. 任何持久化失败时恢复原包；
5. 仅在新的 OpenCode Runtime 验证通过后再变为 `enabled`。

因此发布不会自动改变任何成员运行的版本，也不会绕过验证门禁。

## 治理

创建者或 admin 可以 disabled 团队 Skill。禁用在同一事务内将所有 `enabled` 安装变为 `disabled`；新安装、启用、升级和回滚全部拒绝。Gateway 在每次 Conversation 工作区准备时读取 `listEnabledInstallations` 并原子重建唯一受管的 `.opencode/skills` 目录，因此禁用版本不会再次被发现；系统不递归删除其它工作区数据。

归档只允许 disabled Skill，保留全部版本、安装历史和审计记录，不提供永久删除。审计只保存动作、Skill id、版本 id/状态/摘要，绝不复制私有 Skill 正文或文件。

## API

- `POST /api/skills/:id/versions`：创建私有后继 draft。
- `GET /api/skills/:id/versions`：调用者可见的发布/保留版本摘要；owner/admin 额外看到私有 draft。
- `POST /api/skills/:id/upgrade` 与 `POST /api/skills/:id/rollback`：成员选择 `versionId`，之后需重新 enable。
- `POST /api/skills/:id/disable`：owner/admin 禁用团队资产。
- `POST /api/skills/:id/archive`：owner/admin 归档已禁用资产。

既有发布、安装和启用接口保持兼容。所有写操作继续走登录 Session、CSRF、权限与 metadata-only 审计。
