# Plan

1. 使用专用 Docker MySQL 8.4 测试库跑完整测试。
2. 通过低权限账号执行 dump、manifest 校验、附件 sidecar 恢复。
3. 修正低权限 mysqldump 的 tablespace 依赖并记录边界。
