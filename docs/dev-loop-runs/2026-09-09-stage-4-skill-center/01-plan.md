# Stage 4 团队 Skill 中心计划

## Architecture

以 SQLite 为 Skill 生命周期事实源，HTTP 路由只处理认证边界和安全错误映射，`skill-store` 负责事务、所有权和状态机。草稿不进入 OpenCode 目录；发布后由独立安装服务原子落盘，再通过 OpenCode 验证发现。

## Stages

| 阶段 | 可验收交付 | 主要模块 |
| --- | --- | --- |
| 4A | 私人草稿、数据模型、CRUD API、草稿编辑器 | migration v3、skill-store、skill routes、SkillsPage |
| 4B | 结构/安全/运行校验与报告 | validator、package files、validation jobs |
| 4C | 发布、安装、启用、OpenCode 发现 | publisher、installer、discovery acceptance |
| 4D | 版本、升级、回滚、停用、归档 | lifecycle service、version UI、E2E |

## 4A Task Order

1. 先写迁移失败测试，增加 `skills`、`skill_versions`、`skill_installations` 和约束。
2. 先写 store 行为测试，实现创建、可见列表、详情、修改与归档事务。
3. 先写 API 集成测试，实现路由、所有权、CSRF、安全错误和审计。
4. 先写 React 静态行为测试，实现草稿列表与编辑器，并更新样式。
5. 更新产品 README、路线图、实现日志、验收报告和 HTML 摘要。
6. 运行定向与全量测试、构建、语法、密钥、diff 及桌面/窄屏浏览器验收，中文提交并推送 `main`。

## Expected Files

- Modify: `src/db/migrations.js`
- Create: `src/skills/skill-store.js`
- Create: `src/modules/skills/routes.js`
- Modify: `src/create-workbench-server.js`
- Create: `test/db/skill-database.test.js`
- Create: `test/skills/skill-store.test.js`
- Create: `test/api/skills.test.js`
- Modify: `apps/web/src/features/skills/SkillsPage.jsx`
- Modify: `apps/web/src/styles.css`
- Modify: `test/ui/react-features.test.js`
- Modify: `README.md`, `docs/ROADMAP.md`

## Interfaces

- `createSkillStore(db, options)` returns `createDraft`, `listVisible`, `getVisible`, `updateDraft`, `archiveDraft`.
- `createSkillRouter({ store, requestAuditor })` returns an authenticated router mounted at `/api/skills` after the global CSRF middleware.
- API uses `{ skill }` and `{ skills }` envelopes; private source only appears in detail responses.

## Verification

```bash
node --test test/db/skill-database.test.js test/skills/skill-store.test.js test/api/skills.test.js
node --test test/ui/react-features.test.js
npm test
npm run build
npm run check
npm run security:scan
git diff --check
```

Browser acceptance uses a real local server at 1440×900 and 390×844, with console errors, page errors and horizontal overflow checked.

## Risks

- 旧 `/api/skills` 返回裸数组；4A 会切换为 envelope，必须同步前端和测试。
- 不能让草稿落入 `.opencode/skills`，否则会绕过 4B 校验和人工发布。
- 更新必须同时使旧校验报告失效；4A 先用 `draft` 状态保证，4B 再实现报告版本绑定。
