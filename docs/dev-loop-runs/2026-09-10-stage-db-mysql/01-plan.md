# Implementation Plan

正式计划见 [`docs/superpowers/plans/2026-09-10-mysql-single-datastore.md`](../../superpowers/plans/2026-09-10-mysql-single-datastore.md)。

当前先执行 Task 1。Docker daemon 启动后，在真实 MySQL 8.4 上建立 migration/transaction/capability 验收，不以内存或 mock 替代。
