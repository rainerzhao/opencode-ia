# Stage 1 Product Foundation Plan

详细逐文件计划见：`../../superpowers/plans/2026-09-01-stage-1-product-foundation.md`。

## Delivery Sequence

| Git 阶段 | 可独立交付能力 | 主要验证 | 推送点 |
| --- | --- | --- | --- |
| 1A | SQLite、迁移、用户/Session/审计仓储、首位管理员 CLI | 临时数据库集成测试、CLI 测试、重启持久化 | `main` 提交 1 |
| 1B | 登录、退出、当前用户、密码/Session 撤销、Cookie、CSRF、限速 | 真实 HTTP 认证集成测试 | `main` 提交 2 |
| 1C | REST/WebSocket 权限、默认私有边界、写操作审计 | 两用户隔离、角色矩阵、WebSocket 测试 | `main` 提交 3 |
| 1D | 登录页、账号管理、权限态和浏览器闭环 | Mac 桌面/手机端到端验收 | `main` 提交 4 |
| 1E | React/Vite 迁移、Demo、文档与 Stage 1 总验收 | 构建、回归、浏览器、公开仓库核验 | `main` 提交 5 |

## Architecture Summary

先以向后兼容方式增加 `src/db`、`src/auth`、`src/users`、`src/audit` 模块，并通过依赖注入接入现有 Express 服务；身份边界稳定后再迁移前端。运行数据库和 Session 数据始终位于 `data/`，不会进入 Git。Stage 1 中工作台继续调用当前受控 `opencode run` 边界，常驻 Gateway 留到 Stage 2。

## Review Mode

由于本任务禁止主动使用子代理，架构、产品、测试和安全评审均在 `02-plan-review-rounds.md` 中内联完成。所有阻塞级意见必须在进入实现前关闭。
