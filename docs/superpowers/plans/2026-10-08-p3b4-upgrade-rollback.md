# P3B4 Implementation Plan

**Goal:** 实现已确认的旧发布 → 候选发布 → 升级前恢复库的演练，保留完整公司验收边界。
**Spec:** `docs/superpowers/specs/2026-09-28-p3b4-production-upgrade-rollback-design.md`
**Execution:** 用户已确认方案并要求逐阶段连续实施、更新 README、提交推送；在当前 main 串行实施，不重复请求审批。

## Tasks and interfaces

1. 发布清单（P3B4A）：`src/ops/release-manifest.js` 提供 `createReleaseManifest({ releaseDir, gitSha })`、`validateReleaseManifest({ releaseDir, expectedSha })`、`writeReleaseManifest(...)`；CLI `scripts/release-manifest.js` 提供 create/check。使用 AST 静态读取声明式 MYSQL_MIGRATIONS，绝不执行发布目录的模块。拒绝字段错配、动态表达式、符号链接、缺构建、SHA 错配和覆盖已有清单。使用真实临时目录及 CLI 测试，验证无副作用和错误脱敏。清单是操作员声明加文件一致性检查，不是签名或完整发布包校验和。
2. 发布进程（P3B4B）：`test/fixtures/release-process.js` 提供 start/stop，独立 Node 子进程运行对应发布入口，健康等待、超时、早退及进程组回收。测试真实轻量子进程，确认 SIGTERM/SIGKILL 和清理。
3. 演练配置与编排（P3B4C）：独立 opt-in Linux integration、双空白 TLS MySQL、旧/新发布 SHA 和 Schema 顺序校验。旧代码先初始化并创建 3×3 多轮任务和附件，经 HTTP 复读后停止备份；候选迁移、复读并写新增标识；恢复到空库，以旧代码验证原数据和新增标识不存在。候选失败也演练恢复，最终仍返回失败。API helper 分离，行为测试覆盖顺序、失败和重复终态。
4. 交付（P3B4D）：更新 README、Goal、Roadmap、运维说明，完整单测、build、check、secret scan 和 Linux gate 验证；公司双库/Provider 实跑留作未完成证据。

## Review focus

- Schema 版本相同不等于数据语义向后兼容；自动演练始终恢复升级前备份。
- 旧版本创建源数据，避免候选先迁移源库。
- 读取源历史必须发生在停止旧进程之前（修正规格步骤 4 的矛盾）。
- 发布清单不认证任意代码来源，发布包须由受信 CI 按完整 SHA 构建。
- 数据库恢复时间点以后新增业务数据不会自动保留；正式回滚要求维护窗口冻结写入。

## Verification

每个模块新增失败测试再实现；每个可交付子阶段更新 README 和进度记录并中文提交推送。模块测试使用 `node --test test/ops/<module>.test.js`；交付执行 `npm test`、`npm run build`、`npm run check`、`npm run security:scan`、`git diff --check`。不得把跳过的公司测试计为通过。
