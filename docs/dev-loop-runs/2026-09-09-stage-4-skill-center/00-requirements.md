# Requirements Baseline

## Goal

完成团队 Skill 中心 4A–4D；当前首先交付 4A 私人草稿、SQLite 数据模型、服务端权限 API 与可演示前端。

## Non-goals

- 4A 不执行 Skill、不调用模型、不把草稿写入 OpenCode 发现目录。
- 4A 不实现发布、安装、启用、升级和回滚；这些分别属于 4B–4D。
- 不宣称 Linux 生产就绪。

## User-visible Behavior

- 普通成员创建的 Skill 默认私有，只能查看和编辑自己的草稿。
- 管理员可以查看和治理全部草稿。
- 成员可以保存 `SKILL.md` 草稿、修改展示信息，并以归档代替永久删除。
- 页面明确展示“私人草稿”和当前版本，不把草稿误写成已发布资产。

## Acceptance Criteria

1. 迁移从当前数据库无损升级，并创建完整 Stage 4 核心表与约束。
2. 创建、列表、详情、修改和归档 API 通过认证、CSRF、所有权与状态校验。
3. 跨账号成员读写统一返回 404；审计不包含 `SKILL.md` 正文。
4. slug 唯一、不可修改并经过严格规范化；草稿初始版本固定为 `0.1.0`。
5. 已归档草稿不能继续修改，重复归档幂等。
6. React 页面可创建、切换、编辑和归档草稿，并区分草稿与已发布状态。
7. 完整测试、构建、语法、密钥、diff 和浏览器验收通过后更新 README，中文提交并推送 `main`。

## Constraints

- 所有模型、Agent、Skill 和 Tool 执行必须经 OpenCode。
- 内容默认私有，发布必须人工确认。
- 不新增外部前端 CDN 或在线运行依赖。
- 当前仅在 Mac 做开发验收。

## Assumptions

- 既有批准设计与“每个阶段完成后直接进入下一阶段”的指令视为 full-auto 实施授权。
- 4A 只编辑单个 `SKILL.md`；多文件包在 4B 增加。
- 管理员治理 Skill 正文是团队资产安全职责，不沿用私人 Conversation 的正文不可见规则。

## Open Questions

无阻塞问题；版本规则、安装目录和真实发现细节在对应子阶段按本设计收敛。

## Source Request

用户要求把项目建设为完整产品，Stage 2 与 Stage 4 分阶段开发，每个阶段验收、优化产品化 README，并中文提交推送 GitHub；当前要求继续有效开发并在今晚自动续跑。

## Repo Context

- Base SHA：`e68ae81d08035ee1a27e02464f9f36139caa0b89`
- Branch：`main`
- Stage 2A–2E：已完成 Mac 验收。
- 现有 `/api/skills` 只扫描安装目录，前端只读展示，尚无数据库生命周期。
