# Requirements Baseline

## Goal

让知识库可以接收已导出的 `knowledge-bundle`，在当前账号下重建为新的私有草稿并恢复附件。

## Non-goals

- 不继承原文档 ID、发布状态、版本历史或来源引用。
- 不自动发布、不覆盖既有知识、不改变 OpenCode Runtime。
- 不宣称 Stage 3 或 Linux 生产灾备已完成。

## Acceptance Criteria

1. 导入包和附件摘要、大小、Base64、文件名及扩展名均校验。
2. 导入始终生成新 ID、`private/draft` 状态，附件使用当前账号的新存储键。
3. 非法包返回安全错误，不调用数据库或写入附件文件。
4. React 知识库提供人工选择 JSON 知识包的入口。
