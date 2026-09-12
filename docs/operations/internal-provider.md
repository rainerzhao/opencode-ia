# 内部 Provider 联调清单（Stage 5C）

工作台不直连模型 API。生产请求链路固定为：浏览器 → 工作台 → 常驻 OpenCode Runtime → 公司内部 OpenAI 兼容 Provider。Provider 地址、模型和凭证只放在 OpenCode 的受保护配置文件中，前端、MySQL、日志和 Git 都不保存凭证。

## 配置文件

在 Linux 主机上创建仅服务账号可读的 `/etc/opencode-workbench/opencode.json`（权限 `0600`），示例结构如下。`apiKey` 使用 OpenCode 支持的环境变量引用或主机密钥注入，不要填入真实字面量：

```json
{
  "model": "internal/qwen3-coder",
  "provider": {
    "internal": {
      "options": {
        "baseURL": "https://model.intra.example/v1",
        "apiKey": "${INTERNAL_MODEL_API_KEY}"
      }
    }
  }
}
```

将 `OPENCODE_CONFIG_FILE=/etc/opencode-workbench/opencode.json` 放入权限为 `0600` 的工作台环境文件，并通过 OpenCode 运行环境注入 `INTERNAL_MODEL_API_KEY`。不要把密钥写入 systemd unit、Compose 文件、命令参数或仓库。

## 联调顺序

1. `chmod 600 /etc/opencode-workbench/opencode.json`，确认文件归属 OpenCode 服务账号。
2. 执行 `npm run preflight:production`，再执行 `npm run preflight:opencode`；任一失败都停止发布。
3. 先用 OpenCode 自身的健康/无害模型请求验证 Provider，再启动工作台；工作台 `/healthz` 只验证数据库和 Worker，不回显 Provider 配置。
4. 登录两个测试账号，各创建两个 Conversation，分别执行三轮短请求，确认上下文连续、会话互不串线、取消和断线续传正常。
5. 记录 Provider、OpenCode 版本、Git SHA、迁移版本、请求耗时和错误码摘要；不得记录 Prompt、响应正文、Cookie 或密钥。

## 失败边界

- `401/403`：检查 OpenCode 运行环境注入的凭证和 Provider 权限，不修改工作台代码。
- `429`：降低联调并发并核对 Provider 配额；不得通过增加浏览器连接绕过 Gateway 限制。
- 超时或断流：检查 OpenCode Worker 健康、Provider 网络白名单和超时配置，保留原会话和任务状态。
- 任何密钥出现在日志、Git diff 或 `/metrics`：立即停止联调并轮换凭证。

本清单只完成配置门禁和联调方法；内部 Provider 的真实可达性、模型质量、Linux 进程沙箱、容量与故障演练仍需在公司预发布机实测。
