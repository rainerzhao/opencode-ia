# Implementation Log

- RED：旧 `/api/solutions` 仍返回 200，退役测试失败。
- GREEN：移除 Legacy Router 后旧路径返回 404，正式 `/api/content/solutions` 创建、权限、版本和来源转换回归通过。
- 删除 `SOLUTIONS_DIR` 配置和测试临时目录，方案只使用内容仓储。
