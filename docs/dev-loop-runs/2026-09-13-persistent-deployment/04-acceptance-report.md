# 验收

## Verdict

PASS_WITH_NOTES：本次数据路径与入口的应用级验收通过；目标 Linux 镜像构建仍待外部镜像链路恢复。

## Evidence

- 配置、真 MySQL HTTP/WebSocket 与附件换版读取、部署契约：13 passed，0 failed。
- `WORKBENCH_RUNTIME_STORAGE_ACCEPTANCE=1 OPENCODE_CMD=… node --test test/integration/runtime-data-persistence.test.js`：1 passed，0 failed，OpenCode 1.18.25；临时 HOME/XDG，无 Provider 凭证或模型调用。
- Compose JSON 解析验证 host_ip=127.0.0.1，published=3000，target=3000；数据卷目标 /var/lib/opencode-workbench。
- 启用真 MySQL、TLS 和 Runtime storage 验收运行全量测试：367 tests，362 passed，0 failed，5 个其余真实 OpenCode opt-in 场景跳过。
- React/Vite build、JavaScript syntax（181 files）、密钥扫描与 diff 格式检查通过。

## Remaining

目标 Linux 镜像未构建：基础镜像站代理 403；systemd 真机启动、Nginx HTTPS、公司云数据库和内部 Provider 联调、容量及灾备仍待验收。
