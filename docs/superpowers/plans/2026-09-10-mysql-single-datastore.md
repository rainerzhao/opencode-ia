# MySQL 单一数据层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以 MySQL 8.4 替代所有 SQLite 运行路径，并将应用数据访问改为异步、可事务化的 Repository Interface。

**Architecture:** `mysql2/promise` 连接池和 Database Module 负责连接、迁移锁、事务、健康与能力检测；领域 Repository 只消费该 Interface；Docker Compose 使 Mac 与 Linux 的数据库主版本一致；SQLite 代码和测试在最终迁移后删除。

**Tech Stack:** Node 24、MySQL 8.4、`mysql2/promise`、Docker Compose、Express、React/Vite、Node Test Runner。

**Spec:** `docs/superpowers/specs/2026-09-10-mysql-single-datastore-design.md`

## Task 1: MySQL runtime foundation — 已完成数据库基础验收，尚未切换应用运行时

- [x] 添加 `mysql2` 锁定依赖、Compose、Git 忽略的本地 Secret 模板和明确的环境变量。
- [x] 用真实 MySQL 测试定义健康、时区、字符集、ngram 能力、GET_LOCK、migration version 和 nullable-reference 去重行为。
- [x] 实现异步 Database Module、migration runner 和 schema v1–v5；在真实 MySQL 8.4 容器验证重跑、DDL 失败修正和锁释放。

## Task 2: Identity / audit vertical slice

- [ ] 将 users、sessions、audit Repository 和 bootstrap/auth/middleware 改为 async MySQL。
- [ ] 迁移真实 HTTP fixture 和认证测试；验证 Cookie/CSRF、并发登录、事务回滚和审计脱敏。

## Task 3: Gateway vertical slice

- [ ] 迁移 Conversation、jobs、events、workers、sessions、recovery 与 Gateway service；保持串行 Conversation、公平队列与重启边界。
- [ ] 在真实 MySQL 测试多用户、多 Session、恢复、取消与事件重放。

## Task 4: Skill / content vertical slice

- [ ] 迁移 Skill 包、安装状态、版本治理、知识/方案版本和 MySQL FULLTEXT ngram。
- [ ] 将 Stage 3C 计划改写为 MySQL 实现并恢复来源追溯开发。

## Task 5: remove SQLite and acceptance

- [ ] 删除 SQLite runtime、迁移、环境变量、测试 fixture 与 README 描述；保留一次性受确认离线数据导入工具（若需要）。
- [ ] 恢复 `npm run demo`，使其对 Compose 生命周期给出清晰提示；更新产品 README 与路线图。
- [ ] 完整真实 MySQL 测试、构建、语法、密钥扫描、浏览器验收、HTML 交付说明；中文提交推送 main。
