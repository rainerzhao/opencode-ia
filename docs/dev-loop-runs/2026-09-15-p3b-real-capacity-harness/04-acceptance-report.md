# Acceptance Report

## Verdict

PASS_WITH_NOTES

## Scope Checked

真实 20 活跃任务 Harness 的代码入口、Profile 拓扑和模拟回归兼容性；不包括公司环境实际通过。

## Evidence

| Requirement | Evidence | Result |
| --- | --- | --- |
| 默认模拟兼容 | 20 用户模拟命令仍通过，保持 1×5 槽位 | PASS |
| 20 活跃拓扑 | Profile unit test 断言 4×5=20 | PASS |
| 不可静默模拟 | 新 npm script 显式设置 `WORKBENCH_REAL_ACCEPTANCE=1` | PASS |
| Gateway 使用拓扑 | 集成测试从 Profile 的 Worker 数/容量创建 Pool | PASS |
| 无效配置拒绝 | Profile test 覆盖 0 和非数字值 | PASS |
| 并发拓扑边界 | Profile test 覆盖允许 4×5=20 并拒绝 5×5=25 | PASS |
| 构建与静态安全检查 | production build、204 文件语法检查、secret scan 均通过 | PASS |
| 完整回归 | `npm test`：388 pass、0 fail、24 skip | PASS_WITH_NOTES |
| 公司真实执行 | 缺少公司 Provider/Linux/MySQL 环境 | NOT RUN |

## Residual Risks

模型 Provider 可能拒绝 20 个并行流、限流、超时或产生不同资源消耗；这属于公司预发布真实结果，不是工作台代码能在 Mac 代替证明的事实。完整套件的 24 项跳过测试同样依赖真实 MySQL 或 OpenCode；跳过表示当前 Mac 缺少受控基础设施，不表示通过。
