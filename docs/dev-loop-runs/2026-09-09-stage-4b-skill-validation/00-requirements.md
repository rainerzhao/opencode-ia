# Requirements Baseline

## Goal

完成 Stage 4B：让私人 Skill 草稿具备受控多文件包、确定性结构/安全校验、持久化报告和只经 OpenCode 的受限运行门禁。

## Non-goals

- 不在 4B 发布、安装、启用、升级或回滚 Skill。
- 不把私人草稿写入团队 OpenCode 发现目录。
- 不在 Node/宿主 Shell 直接执行成员上传的脚本。
- 不宣称 Linux 生产就绪。

## User-visible Behavior

- 成员可以为自己的草稿维护受控附加文本文件。
- 成员可以发起校验并看到结构、安全和运行结果。
- 修改正文或附加文件会明确使旧报告失效。
- 未通过全部门禁的版本保持私人 draft，不能进入后续发布。

## Acceptance Criteria

1. migration v4 无损增加附加文件模型并强制版本归属、路径和大小一致性。
2. frontmatter、名称一致性、路径、文件限制、疑似秘密和危险命令有稳定校验结果。
3. 报告不包含秘密命中原文；审计不包含 Skill 正文。
4. 版本内容变化使旧报告失效；过期异步结果不能覆盖新内容。
5. 只有静态与 OpenCode 受限运行都通过才进入 `validated`。
6. 跨账号成员不能读取文件、报告或触发校验，统一返回 404。
7. React 页面、桌面/手机浏览器、全量测试、构建、语法、密钥和 diff 门禁通过。

## Constraints

- 工作台不直连模型 API；所有 Skill 运行经过 OpenCode。
- 默认私有，发布仍需在 Stage 4C 人工确认。
- 不增加必须联网安装的新运行依赖。
- GitHub 网络恢复前保留本地阶段提交并在续跑时优先补推。

## Assumptions

- 首版附加文件只接受 UTF-8 文本；二进制资源不进入 4B。
- 真实运行适配复用现有 OpenCode Worker/Client 和工具限制。
- 用户已授权每个阶段完成后直接进入下一阶段并推送 `main`。

## Open Questions

无阻塞问题。

## Source Request

继续把项目建设为完整的商用多人 OpenCode 工作台，Stage 4A 完成后直接进入 4B，保持默认私有、所有执行经 OpenCode、每阶段 README/中文提交/push。

## Repo Context

- Base SHA：`2cf6cc1b5d39543bf2a8fbe4cb8b5b2e43157427`。
- Branch：`main`。
- Stage 4A：本地已提交；GitHub 网络超时导致远端暂未同步。
