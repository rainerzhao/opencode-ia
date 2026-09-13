# 计划

1. 重现附件落到发布目录的缺陷，在 MySQL HTTP 集成中上传附件并更换代码目录后再次下载。
2. 统一 WORKBENCH_DATA_DIR 的可变路径派生，保留开发默认值和专用路径覆盖项。
3. Docker/systemd 显式设置持久 XDG 路径，配置私有状态目录及 Runtime 初始目录。
4. Compose 发布回环端口，与既有宿主机 Nginx 配套，补齐进程停止和重启配置。
5. 验证真实 OpenCode 的 Session 跨 Worker 实例保留；执行 Compose 解析、镜像构建尝试及全量回归。
