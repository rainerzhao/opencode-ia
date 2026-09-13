# 云 MySQL 首次管理员初始化

## Goal

修复生产部署管理员 CLI 仍写 SQLite 的断链。生产环境从同一 WORKBENCH_DATABASE_URL 初始化管理员，能够登录工作台，并发初始化仅允许一个成功。

## Constraints

密码只从标准输入获取，输出和审计不含密码或连接串；缺少生产连接串、混用 SQLite 路径、MySQL 失败均拒绝操作；保留开发 SQLite 初始化。

## Baseline

main，77d6e832dcd3640f7518aad636243fba1c6af926；4 组已有未跟踪材料不在修改范围内。沿用用户自动实施、更新 README、中文提交并推送授权。
