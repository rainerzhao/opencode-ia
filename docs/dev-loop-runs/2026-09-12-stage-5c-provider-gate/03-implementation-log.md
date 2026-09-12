# Implementation Log

- 新增 `scripts/check-opencode-provider.js` 和 `npm run preflight:opencode`。
- 新增 Provider 配置门禁测试，覆盖 0600、Provider、base URL、默认模型和脱敏输出。
- Compose 使用 `OPENCODE_CONFIG_FILE` 与只读主机挂载；内网手册说明真实联调顺序。
- 未读取、修改或提交任何真实密钥。
