# Stage 4B Skill 校验系统设计

## 目标

让成员在私人草稿阶段就能看到一份可追溯、可重复的校验报告。只有结构、安全和受限运行门禁全部通过的版本，才可以在 Stage 4C 被人工发布。校验本身不改变 Skill 的私有可见性，也不把草稿写入 OpenCode 团队发现目录。

## 校验分层

1. **包边界**：只接收 `SKILL.md` 和受控的 UTF-8 文本附加文件；拒绝绝对路径、`..`、反斜杠、空目录段、隐藏路径、控制字符和超限内容。
2. **结构**：`SKILL.md` 必须以 frontmatter 开头，必须有唯一的 `name` 与 `description`；`name` 必须等于 Skill slug。
3. **安全**：检查疑似 API Key、私钥、内嵌凭证以及高风险命令模式。报告只记录规则、文件和行号，不复制命中的秘密原文。
4. **受限运行**：通过 OpenCode Gateway 的隔离执行边界验证 Skill；工作台不直接调用模型，也不直接在宿主 Shell 执行 Skill 脚本。

前三层是确定性静态门禁，必须先通过才能进入受限运行。真实运行不可用或失败时，版本不得进入 `validated`，不能在 4C 发布。

## 包模型

- `SKILL.md` 继续保存在 `skill_versions.skill_md`，是唯一入口文件。
- migration v4 新增 `skill_files`，保存同一版本的附加 UTF-8 文本文件。
- 单版本最多 64 个附加文件；单文件最多 256 KiB；`SKILL.md` 加全部附加文件总计最多 1 MiB。
- 路径使用 `/` 分隔的相对 POSIX 路径，最长 200 字符、最多 6 层；允许 `.md/.txt/.json/.jsonc/.yaml/.yml/.js/.mjs/.cjs/.ts/.py/.sh`。
- 文件列表以完整替换方式保存，事务内删除旧文件并写入新文件；版本非 draft 时禁止修改。

## 报告模型

`validation_report_json` 使用版本化 JSON：

```json
{
  "schemaVersion": 1,
  "verdict": "pass",
  "checkedAt": "2026-09-09T00:00:00.000Z",
  "contentSha256": "...",
  "summary": { "errors": 0, "warnings": 0, "files": 1, "totalBytes": 120 },
  "checks": [
    { "id": "frontmatter", "status": "pass", "severity": "error", "message": "frontmatter is valid" }
  ],
  "runtime": { "status": "passed", "provider": "opencode-gateway" }
}
```

- 任何静态 error、运行失败或运行未执行都会使最终 verdict 为 `fail`。
- 通过后 `skill_versions.status = validated`；失败时保持 `draft`，但保存报告。
- 修改 `SKILL.md` 或附加文件立即清空旧报告并恢复 `draft`。
- 持久化前比较内容摘要，防止校验期间草稿被修改后写入过期报告。

## API 与界面

- `PUT /api/skills/:id/files`：完整替换附加文件列表。
- `POST /api/skills/:id/validate`：运行静态门禁和受限 OpenCode 校验，返回更新后的 Skill 详情。
- Skill 页面显示附加文件编辑、校验动作、错误/警告数量和逐项报告；不能把失败文案误写成已发布。
- API 审计只记录 verdict、计数、规则 ID 和版本，不记录文件正文或命中值。

## 安全边界

- 任何秘密规则命中只返回规则名、相对路径和行号。
- 不接受二进制、符号链接、硬链接、设备文件或请求提供的宿主路径；API 只接收 JSON 文本内容。
- 静态门禁不执行上传内容。
- 受限运行继续使用账号/Conversation 隔离目录、pure 模式和默认关闭 Bash、联网、子代理、外部插件的 OpenCode Runtime。
- Mac 验收不等于 Linux 生产就绪。

## 验收出口

- 安全包能生成并持久化完整报告；修改后旧报告失效。
- 非法 frontmatter、名称不一致、路径逃逸、超限、疑似秘密和危险命令均有稳定规则结果。
- 跨账号不可触发或读取校验；审计无正文和命中值。
- 真实 OpenCode Gateway 受限运行通过，失败/超时/不可用均阻止 `validated`。
- 自动测试、构建、密钥、浏览器和真实运行证据完成后，更新 README，中文提交并推送。
