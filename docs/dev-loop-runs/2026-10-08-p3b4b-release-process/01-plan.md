# Plan

实现 `test/fixtures/release-process.js`，接口 `startRelease({ releaseDir, env, port, startupTimeoutMs, shutdownTimeoutMs })` 返回 baseUrl/pid/stop。PID 只用于内部清理，不进入摘要。

先新增 `test/ops/release-process.test.js` 失败测试，再实现：输入/端口检查 → 独立 spawn → 有界 health → 幂等 stop → 进程组升级信号。finally 由调用者使用 stop，启动失败由 helper 自清理。

验证真实轻量 HTTP 子进程，不依赖 MySQL 或 OpenCode；全量回归、build、check、security scan、diff check 后交付。P3B4C 必须另验证真实发布应用停服、状态与数据库行为。
