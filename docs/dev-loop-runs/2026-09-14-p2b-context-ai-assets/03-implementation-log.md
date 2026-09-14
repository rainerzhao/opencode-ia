# P2B Implementation Log

## Delivered

- AI 平台从当前私有 Conversation 的已保存连续事件范围请求需求草稿；请求仍只经 OpenCode Gateway。
- 需求页显示仅本人可见的草稿收件箱；生成中的草稿会通过私有详情接口回收状态。
- 成员可以选择 BU、修订并确认草稿建立私有需求，或拒绝草稿；没有自动创建或公开动作。
- 需求详情可关联并移除自己可用的 Conversation、知识或方案；服务端继续执行所有权二次校验。
- Demo Worker 只为隔离验收返回确定性结构化草稿，不调用模型 Provider 或读取 API Key。

## Regression Fix

浏览器验收发现草稿列表只读取 generating 状态而未回收详情，导致完成的 Gateway 任务不能出现在确认表单。新增 `reconcileDrafts`，仅对 generating 草稿访问其私有详情端点，并以回收后的状态渲染；失败时保留原状态，不创建需求。

## Verification

- `node --test test/ui/react-features.test.js test/ui/react-build.test.js`：24 pass，0 fail。
- `npm run build`：成功。
- 隔离 Demo 浏览器：BU 配置 → 新建 Conversation → 发消息 → 生成草稿 → 回收 ready → 选择 BU 并确认 → 私有需求出现 → 关联当前 Conversation。
- 390px：`scrollWidth === clientWidth === 390`，无横向溢出。
