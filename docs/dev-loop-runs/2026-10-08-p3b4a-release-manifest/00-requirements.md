# Requirements Baseline

## Goal
交付 P3B4A 发布清单生成与校验，为已确认的跨版本升级/回滚提供可信输入边界。
## Non-goals
不启动发布、不执行迁移、不调用模型；不声称公司生产验收完成。
## User-visible Behavior
运维可生成一次清单，并在部署前检查版本与包结构；错误脱敏。
## Acceptance Criteria
静态读取迁移最高版本、严格 SHA/应用版本匹配、拒绝动态源码和符号链接、拒绝覆盖清单、CLI 非零失败。
## Constraints
发布目录必须由受信 CI 生成并保持不可变；清单不提供签名或完整文件哈希认证。
## Assumptions
使用已确认设计与连续开发授权，不增加重复审批；串行实现、主代理内联复核，不新增子代理。
## Open Questions
无本阶段阻塞项。公司双库与 Provider 验收留后续。
## Source Request
用户确认 P3B4 方案，要求按阶段开发、测试、更新 README 并提交推送。
## Repo Context
main，基线 fdd5b31；已有四项无关未跟踪内容原样保留。开始时 package/lock 与 P3B4 计划为本任务改动。
