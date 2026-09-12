# Implementation Log

- `WORKBENCH_TEST_MYSQL_URL` 指向专用 MySQL 8.4 Docker 测试库。
- 全量测试补跑此前跳过的 MySQL 场景；SQL dump 与 Knowledge 附件 sidecar 恢复成功。
- `mysqldump` 增加 `--no-tablespaces`，避免应用账号需要 PROCESS 权限。
