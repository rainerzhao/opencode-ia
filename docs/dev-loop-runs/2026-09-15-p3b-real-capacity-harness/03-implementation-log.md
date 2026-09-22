# Implementation Log

## Delivered

- Capacity Profile 现在明确包含 `workerCount`、`workerCapacity` 与其乘积 `executionSlots`。
- 默认和既有模拟 20 用户回归仍为 1 Worker × 5 槽位。
- 受限环境变量 `WORKBENCH_ACCEPTANCE_WORKER_COUNT` 与 `WORKBENCH_ACCEPTANCE_WORKER_CAPACITY` 支持严格正整数拓扑；非法值明确拒绝。
- 验收拓扑上限为 20 个执行槽位；`5 Worker × 5 slots` 会被明确拒绝，避免将团队目标外的并发配置误带入公司预发布。
- 多会话集成测试从 Profile 读取 Worker Pool 拓扑，不再硬编码为一个 Worker。
- 新增 `npm run test:capacity:20:real`，显式开启真实 OpenCode、20 用户、4 Worker、每 Worker 5 槽位。

## TDD Evidence

1. 先增加 `5×5` 被拒绝的测试，并运行 `node --test test/gateway/capacity-acceptance-profile.test.js`；旧实现如预期因未抛错而 RED。
2. 实现 Profile 拓扑 seam、20-slot 上限，并令 Gateway 集成消费该 seam。
3. `node --test test/gateway/capacity-acceptance-profile.test.js`: 4 pass, 0 fail。
4. `npm run test:capacity:20`: 20 用户、20 WebSocket、60 Conversation、3 轮、180 模拟任务完成；最大运行 5，单用户最大 1，队列峰值 55。
5. `npm run build`: Vite production build 成功。
6. `npm run check`: 204 个 JavaScript 文件语法检查通过。
7. `npm run security:scan`: 无密钥扫描发现。
8. `npm test`: 388 pass、0 fail、24 skip；跳过项均要求真实 MySQL 或 OpenCode，未被当作本机生产验收。

## Real-Run Boundary

未运行 `npm run test:capacity:20:real`：本机没有公司 Provider、受保护配置、云 MySQL 或 Linux 服务账号。命令本身不会降级为模拟模式；真实运行失败必须保留安全错误码并在公司预发布机排查。
