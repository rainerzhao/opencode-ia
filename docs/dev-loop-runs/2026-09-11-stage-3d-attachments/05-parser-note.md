# Stage 3D 附件解析补充

- 受认证的 `GET /api/content/knowledge/:id/attachments/:attachmentId/preview` 支持 UTF-8 Markdown、TXT、CSV 和 JSON；JSON 会先解析再格式化，预览上限为 1 MiB。
- DOCX/PDF 暂不做内容解析，返回明确的 `415 ATTACHMENT_PARSE_UNSUPPORTED`；原始文件仍可下载。
- 解析只提供受控预览，不自动把附件内容写入团队搜索索引；导入导出和版本差异仍是后续工作。
