# Acceptance Report

## Verdict
PASS_WITH_NOTES，仅 P3B4B 发布进程 helper。

## Scope Checked
真实独立子进程启动、健康门禁和进程组停止；主代理内联需求/测试/代码/安全复核。

## Tests Run
- 聚焦 9/9 通过。
- `npm test`：459 项，434 通过、25 环境相关跳过、0 失败。
- `npm run check`：219 JS 文件通过。
- `npm run security:scan`：无发现。
- `git diff --check`：通过。

## Requirement Coverage
自己的入口/cwd/env、凭证不进 argv、子进程输出不转发、提前退出、数据库与 Gateway 健康、有界启动/响应体读取、幂等停止、优雅信号、SIGKILL 升级、同组后代回收、占用端口保护均有测试。

## Findings and Fixes
Mac 系统目录别名导致测试字符串比较失真，使用 realpath 验证物理目录。没有因测试通过而放松数据库/Gateway 健康判定。

## Residual Risks and Follow-ups
仅 Mac 本地轻量进程验证，不是 Linux 真实 OpenCode 证据。外部工具自行逃逸进程组需 systemd/cgroup 限制；端口存在预检与启动之间的竞态，验收需独占端口。P3B4C 仍需接入双库、真实发布程序停服、历史与附件校验；任何真正升级前不得省略上述验证。
