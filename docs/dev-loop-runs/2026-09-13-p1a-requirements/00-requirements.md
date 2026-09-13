# P1A 需求与沟通底座

## Goal

按已确认的 PRODUCT_GOAL.md 建立独立需求模块，支持 BU、私有需求、手工沟通记录、筛选与审计。

## Non-goals

本阶段不发布共享需求，不接入 IIM/电话采集，不直接调用模型，不替换现有前端。

## User-visible Behavior

登录用户只能管理自己的需求和沟通；管理员维护统一 BU 目录，但管理员身份本身不授予私人需求正文访问权。负责人第一版为创建者，跨用户移交需要后续明确授权流程，不能仅凭填写他人 ID 共享。

## Acceptance Criteria

- 核心字段：title、buId、scenario、description、status；状态为 draft、clarifying、in_progress、resolved、archived。
- 沟通记录包含 channel（iim、phone、meeting、manual）、content、occurredAt；保存的是用户提交的原始纪要，非 AI 确认结论。
- 拒绝额外字段、伪造身份/可见性、无效时间和无界查询；正文支持换行，名称不接受控制字符。
- MySQL 新增迁移不覆盖旧表；新增数据经关闭重连后仍可读取。
- HTTP 创建、读取、更新、分页/筛选、归档和沟通追加均受认证/CSRF保护。
- 跨用户及管理员越权读取/修改返回相同 404；列表与检索不泄露正文或数量。
- 写操作记审计，日志不存沟通正文；失败不得报告成功。

## Constraints

生产云 MySQL；默认私有；所有后续 AI 提取经 OpenCode；不修改现有未跟踪材料。

## Assumptions

BU 名称为团队目录，可由管理员创建；新需求必须引用已有 BU。首批不做硬删除，保留归档与原始沟通记录。

## Open Questions

当前可按上述保守权限边界实施。共享/转交与模板版本在后续阶段设计，不默认开放。

## Source Request

用户确认“需求与场景”为核心并要求按阶段持续开发，新 Goal 已生效。

## Repo Context

main，基础 HEAD 709501ee910736587190230afc58ea9588463606。目标/README/路线图为本轮相关改动；4 组此前未跟踪材料保留。采用当前任务内串行开发及内联评审，未委派子代理。
