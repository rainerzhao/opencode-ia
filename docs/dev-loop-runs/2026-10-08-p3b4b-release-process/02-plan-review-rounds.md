# Inline Review

架构/安全/测试/文档由主代理内联复核；没有独立审查代理。

- IMPORTANT：父进程退出不代表 Worker 已退出；按进程组等待与升级 SIGKILL，已有真实后代测试。
- IMPORTANT：HTTP 200 不足以认为健康；同时要求 status/database/gateway 为 healthy。
- IMPORTANT：HTTP 响应体挂起也需受启动超时控制；AbortSignal 覆盖 body 读取，有真实测试。
- QUESTION：Mac /var 与 /private/var 是否不同目录？独立命令证实同一物理目录，测试用 realpath 比较，不改变发布路径契约。
- 已记录限制：逃逸进程组需外部 supervisor；端口预检不是租约；当前生产入口的完整优雅停服仍需 P3B4C 联调。

本模块无未解决阻塞项，不把局部 helper 通过视作整个 P3B4 通过。
