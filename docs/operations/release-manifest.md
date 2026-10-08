# 发布包清单

升级前需要明确“运行哪份代码、需要哪个数据库版本”。每个受信发布包构建完成后生成一次 `release-manifest.json`，部署前重新校验；已有清单不会被覆盖。

在工具所在仓库运行（替换绝对路径和完整 SHA）：

```bash
npm run release:manifest -- create /absolute/release/directory FULL_40_CHARACTER_LOWERCASE_SHA
npm run release:manifest -- check /absolute/release/directory FULL_40_CHARACTER_LOWERCASE_SHA
```

必需文件：`package.json`、`scripts/start-production.js`、`dist/web/index.html`、`src/db/mysql-migrations.js`。发布目录与这些文件及内部父目录不得为符号链接。迁移文件通过 AST 静态读取，仅接受仓库现有的声明式迁移格式，不执行待校验发布包中的 JavaScript。

清单包含格式版本、Git SHA、应用版本、MySQL 迁移最高版本。校验将 SHA 与操作员预期值、其余版本与发布包内容比较。成功输出 `{"valid":true}`；失败返回非零退出码及固定错误码，不输出路径、SHA 或底层异常。`RELEASE_MANIFEST_EXISTS` 表示目标清单已存在；`RELEASE_MANIFEST_INVALID` 表示输入或发布结构不满足契约。

## 安全边界

- SHA 是 CI/发布人员的声明，清单不是数字签名，也不覆盖每个文件的内容哈希。必须由受信 CI 按指定 SHA 构建，并保护构建产物与发布目录不被并发修改。
- 校验入口只检查文件存在性与元数据一致性，不证明构建页面、依赖或运行时功能正确。必须另行完成测试、依赖安装和生产验收。
- 本工具不会启动工作台、访问数据库、调用模型或修改生产流量。
- 发布进程 Harness 已提供独立启动、健康等待、提前退出和超时分类，以及 SIGTERM → SIGKILL 进程组回收；仅在 Mac 上以轻量真实子进程验证，尚未接入双库编排。它不采集子进程输出，避免凭证进入日志；错误只返回固定代码。
- Harness 清理同进程组的后台进程；当前 Worker 启动不脱离进程组。如果外部工具自行 daemonize/setsid，需另用公司 systemd/cgroup 约束，不能宣称此 Harness 能回收逃逸进程。端口预检查也不是端口所有权租约，运行时必须隔离验收端口。
- 完整升级和回滚编排尚未交付。正式回滚要求维护窗口冻结写入；恢复旧备份不会自动保留备份后的业务数据。
