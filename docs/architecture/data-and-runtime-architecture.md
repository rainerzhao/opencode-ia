# 数据层与 Agent Runtime 架构

## 结论

OpenCode 团队工作台采用 **MySQL 8.4 + OpenCode 常驻 Runtime** 的分层架构。MySQL 是产品业务状态的单一事实源；OpenCode 是唯一执行模型、Agent、Skill 和工具的 Runtime。两者职责不同，不能互相替代。

这是一种适合内网团队 Agent 产品的常见基线：先以关系数据库保证账号、权限、会话、审计、内容版本与可靠状态恢复，再由常驻运行服务承载实际 Agent 执行。商业产品可能在规模更大时使用 PostgreSQL、Redis、Kafka 或 Kubernetes，但它们不是 15–20 人内网首版的前置条件。

## 必须分开的四个对象

| 对象 | 含义 | 归属 |
| --- | --- | --- |
| Conversation | 用户可见的私有工作上下文、历史和权限边界 | MySQL 业务记录 |
| OpenCode Session | Conversation 对应的 OpenCode 原生连续上下文 | MySQL 绑定关系 + OpenCode |
| Worker Runtime | 后台长期存活的 OpenCode 进程/服务实例 | Gateway 进程管理 |
| 执行槽位 | 此刻允许同时推理的资源配额 | Gateway 调度策略 |

一个用户可以拥有多个 Conversation；多个 Session 可以复用少量常驻 Worker；Worker 数量与并行执行槽位都不按用户数一一对应。每个 Conversation 内仍串行执行，以避免上下文竞争；不同用户和不同 Conversation 由公平队列调度。

## 责任边界

```text
浏览器 / React
  │ REST、WebSocket（不携带 Provider Key）
Express API + Gateway 控制面
  ├── MySQL 8.4
  │     账号、登录 Session、权限、审计
  │     Conversation、OpenCode Session 绑定、Job、事件、恢复边界
  │     Skill/知识/方案版本、发布、安装、可见性与来源
  ├── 受管文件目录
  │     Skill 包、附件、导入导出与备份产物
  └── OpenCode Worker Pool
        创建/恢复 OpenCode Session、执行 Agent/Skill/Tool
        通过 OpenCode 配置调用内部 OpenAI 兼容模型
```

工作台前端不直连模型 API；MySQL 也不保存 Provider Key 或充当模型代理。Provider 配置与密钥由 OpenCode 运行环境管理。

## MySQL 的职责与非职责

MySQL 负责持久化可治理状态：账号、权限、登录会话、审计、队列状态、事件序号、重启恢复标记、Skill/内容版本和发布关系。它还提供事务、唯一约束、迁移版本、并发迁移锁和中文全文检索能力。

MySQL 不负责保持 Agent 思考过程或替代 Worker 进程。实时输出经 WebSocket/SSE 传递；需要断线重放的业务事件才会持久化。附件和大体积导入导出不塞入关系表，而是保存到受控文件目录，并由 MySQL 保存元数据、权限和哈希。

## 首版容量与演进

当前目标是单台内网 Linux 服务约 15–20 名成员。首版使用 MySQL 事务状态与 Gateway 公平队列即可，重点验收多账号、多 Conversation、常驻 Worker、重启恢复、权限隔离和实际模型连续多轮对话。

当未来出现多台 Gateway、远高于当前的任务吞吐、跨机 Worker 调度或独立异步流水线时，再评估增加专用队列/事件总线和对象存储；这是扩展路径，不是当前用 MySQL 的替代品。

## 当前实现状态

MySQL 8.4 Docker 数据库基础、迁移锁、UTF-8/UTC、中文 `ngram` 与 schema 已在 Mac 真库验证。应用的用户、Gateway、Skill、内容仓储尚在从 SQLite 异步迁移，因而本文是已确认的目标架构，不表示 Linux 或 MySQL 应用运行时已上线。
