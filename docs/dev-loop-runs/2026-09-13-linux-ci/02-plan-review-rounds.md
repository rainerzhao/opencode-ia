# 内联审查

APPROVED；未使用子代理。

- workflow 用 pull_request 而非 pull_request_target，不在不受信任代码执行中暴露写权限。
- Action 固定提交 SHA；checkout 不保留 Git 凭证。所有测试数据库密码是一次性测试常量。
- 镜像检查在 --network none 的一次性容器运行；无公司数据库或模型调用。
- MySQL CI 容器不是生产部署选择，生产仍连接公司云数据库。
- GitHub runner 成功只证明 Linux 干净环境验收，不替代公司预发布。
