# Stage 4C Skill 发布、安装与发现设计

## 目标

把 Stage 4B 已校验的私人 Skill 变成可由人明确发布、由团队成员独立安装和启用的团队资产。工作台负责身份、状态、文件落盘和审计；OpenCode 负责发现与执行。发布、安装、启用是三个独立且可追溯的动作。

## 方案选择

1. **全局共享 `.opencode/skills`**：实现最简单，但一经发布所有账号都会自动启用，不能表达成员自己的安装状态，拒绝。
2. **每用户受管安装目录 + Conversation 工作区物化（采用）**：发布包仍由中心数据库管理；安装后写入用户专属受管目录；启用后在该用户的每个 Conversation 工作区原子生成 `.opencode/skills`，与共享 Worker 架构兼容。
3. **每用户独占 OpenCode Runtime/Home**：隔离更强，但会把 Runtime 数量与用户数量绑定，属于 Stage 5 容量和 OS 隔离议题，本阶段不采用。

## 生命周期与权限

- 只有 Skill 所有者或管理员可以发布；版本必须为 `validated`，报告 verdict 必须为 `pass`，Runtime 必须为 `passed`，报告摘要必须等于当前内容摘要。
- 发布把 `skills.status` 设为 `published`、visibility 设为 `team`，把当前版本设为 `published` 并记录 `published_at`。发布后包不可修改。
- 任意有效成员可以查看团队已发布 Skill，并为自己安装、启用；不能替其他用户操作安装状态。
- 安装表示不可变版本已经原子写入用户受管目录；启用表示真实 OpenCode 已验证能发现该安装包，并允许后续 Conversation 工作区物化。
- 4C 不创建新版本，不升级或回滚，也不停用已发布 Skill；这些属于 4D。

## 文件模型

- 新配置 `SKILL_INSTALL_ROOT`，默认 `<root>/data/skill-installations`，不位于 Git 仓库的公开 Skill 发现目录。
- 用户安装路径由服务端派生为 `<installRoot>/<userId>/<slug>`，目录 0700，文件 0600。
- 安装先在同一父目录创建临时目录，写入 `SKILL.md`、附加文件和 `.workbench-install.json`，校验后原子 rename；数据库写入失败时删除新目录。
- Conversation 执行前查询该账号的 enabled 安装，把受管包复制到工作区临时 `.opencode/skills-next-*`，完成后原子替换 `.opencode/skills`。不使用软链接或硬链接。
- 物化只读取服务端派生的受管目录；拒绝符号链接、硬链接、特殊文件、摘要漂移和路径逃逸。

## API 与界面

- `POST /api/skills/:id/publish`：人工发布当前 validated 版本。
- `GET /api/skills?status=published`：团队已发布目录。
- `GET /api/skills/installations`：当前登录账号的安装状态。
- `POST /api/skills/:id/install`：安装当前发布版本。
- `POST /api/skills/:id/enable`：真实 OpenCode 发现成功后启用。
- React Skill 页面分为“我的草稿”和“团队已发布”；发布按钮只在已校验版本出现，并进行明确确认；团队目录显示安装/启用状态。

## 失败与补偿

- 发布条件任一不满足返回稳定 409，不改变可见性。
- 安装文件写入、权限或摘要校验失败时不写数据库；数据库失败时清理新目录。
- 启用验证失败时保持 `installed`，不进入 enabled；已存在工作区不会得到该 Skill。
- 工作区物化失败时业务任务失败并记录安全错误，不以部分 Skill 集合继续执行。
- 审计只记录 Skill、版本、动作、状态和摘要，不记录 Skill 正文、文件内容或 Provider 信息。

## 验收

- 所有者发布通过，未校验、报告过期、跨账号发布均失败；发布包不可再编辑。
- 其他成员可以看到、安装和启用；账号之间安装目录和状态隔离。
- 文件落盘、数据库补偿和工作区物化具备失败测试，目录/文件权限符合 0700/0600。
- 真实 OpenCode 能发现启用后的精确 slug；未安装或未启用账号不能发现。
- 无密钥 Demo、React 桌面/手机、全量门禁、README、中文提交和 Git 推送完成。

Mac 验收不等于 Linux 生产就绪；内部 Provider、OS 级沙箱、备份和长期容量仍属于 Stage 5。
