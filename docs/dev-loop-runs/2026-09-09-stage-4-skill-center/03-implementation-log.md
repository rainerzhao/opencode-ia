# Implementation Log

## Stage 4A

### 数据与领域层

- Migration v3 新增 `skills`、`skill_versions`、`skill_installations` 三张 STRICT 表及生命周期、唯一性、外键和索引约束；组合外键保证安装记录引用的版本确实属于同一个 Skill。
- `createSkillStore` 实现私人草稿创建、列表、详情、更新和幂等归档；初始版本固定为 `0.1.0`，内容写入 SHA-256 摘要。
- 普通成员只访问自己的草稿；管理员可以治理全部草稿；团队可见读取只允许 `published/disabled`，避免误配置泄露 draft/archived。
- 列表查询只关联每个 Skill 的最新版本，提前覆盖 4D 多版本场景。

### API 与前端

- `/api/skills` 从目录扫描替换为认证后的生命周期 API，沿用全局 Session、CSRF、权限和安全错误处理。
- 创建、修改和归档审计只记录状态、版本和资源标识，不记录 `SKILL.md` 正文。
- React Skill 页面升级为私人草稿工作区，支持创建、切换、编辑和归档，并明确显示草稿与版本状态。

### 红绿过程

- 迁移、Store、API 和 React 行为均先以失败测试定义，再完成最小实现。
- 收尾复核新增三个回归：误置为 team 的 draft 不得向其他成员泄露；多版本 Skill 列表不得重复；安装记录不得把一个 Skill 错配到另一个 Skill 的版本。每个用例都先观察到预期失败，再完成修复。

### 浏览器验收

- 真实 Demo 浏览器完成创建、编辑、归档流程。
- 1440×900 与 390×844 的 `documentElement` 横向溢出均为 0。
- Console 与 Page Error 均为空。
- 截图：`artifacts/screenshots/stage-4a-skill-desktop-final.png`、`stage-4a-skill-mobile-final.png`。
- 关闭 Demo 后端口释放，隔离临时目录已自动删除。

### 最终门禁

- `npm test`：229 tests，227 pass，2 个显式真实环境用例 skip，0 fail。
- `npm run build`：40 modules transformed，退出码 0。
- `npm run check`：97 files，退出码 0。
- `npm run security:scan`：无发现，退出码 0。
- `git diff --check`：退出码 0。
