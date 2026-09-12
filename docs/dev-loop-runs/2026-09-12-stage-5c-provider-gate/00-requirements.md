# Requirements Baseline

## Goal

为内部 OpenAI 兼容 Provider 与真实 OpenCode 联调提供一个不会把凭证带入工作台、日志或 Git 的配置门禁。

## Acceptance Criteria

- Provider 配置来自绝对路径文件，文件为普通文件且权限为 0600。
- JSON 至少声明一个 Provider、HTTP(S) base URL 和默认 model。
- 检查结果只输出 Provider 数量和模型名，不输出地址、凭证或配置正文。
- 内网部署手册与 Compose 模板给出同一配置路径和联调顺序。

## Constraints

本阶段不调用真实 Provider，不修改用户密钥，不宣称 Linux 或模型服务已验收。
