# 验收

## Verdict

PASS：首次 GitHub Actions 已成功，Linux 构建与本次基础运行检查通过。

## Evidence

- [Actions run 34756682602](https://github.com/rainerzhao/opencode-ia/actions/runs/34756682602)，代码提交 `7db3d0da7f46e0f6fc6809d7ac0eca0888c6a6f4`，Ubuntu 24.04 / Node 24，2026-09-13。
- 367 tests：361 passed，0 failed，6 skipped（真实 OpenCode 可选场景；runner 未安装 OpenCode，也不使用模型密钥）。MySQL 8.4 与实际 TLS dump/restore 已执行。
- `deploy/Dockerfile` 的 Linux/amd64 镜像成功构建；无网络容器内确认非 root、编译后的前端资源、持久路径可写、本机配置/数据排除项。
- 默认入口在缺少 WORKBENCH_DATABASE_URL 时以状态 1 退出。
- JavaScript 语法 182 files、前端 build、密钥扫描全部通过。
- 临时 MySQL 清理步骤成功。镜像仅用于 CI 验证，未发布到镜像仓库。

## Required evidence

干净 Ubuntu 上的 MySQL/TLS 测试、实际 Linux 镜像构建、非 root 和持久路径检查、缺少配置启动拒绝。

## Boundary

不包含真实内部 Provider、公司网络、OS 沙箱、生产容量或灾备结论。
