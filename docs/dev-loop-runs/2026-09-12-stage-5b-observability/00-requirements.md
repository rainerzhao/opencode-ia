# Requirements Baseline

## Goal

提供可供内网监控抓取的聚合指标，同时不暴露账号、会话、业务标题、Provider 或密钥。

## Acceptance Criteria

1. `/metrics` 无需登录即可读取聚合 HTTP 和 Gateway 指标。
2. 计数器、活动请求和 Worker/队列状态正确更新且不出现负数。
3. 输出符合 Prometheus 文本格式，不含业务请求数据。
