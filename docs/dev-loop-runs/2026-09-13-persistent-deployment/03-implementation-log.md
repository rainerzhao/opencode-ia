# 实施记录

- 旧实现失败：未解析 contentAttachmentRoot，真实上传未落入指定持久目录。
- 新增数据根与附件目录配置；应用所有相关可变路径由数据根派生。MySQL 集成将发布目录从 release-one 切换至 release-two，原附件可读取。
- Docker/systemd 设置四个持久 XDG 目录；Docker 预建私有目录，systemd 启用 StateDirectory、UMask 和 Runtime 预建。
- Compose 解析确认仅工作台服务、回环 3000 端口映射、数据卷、init、重启策略和停止宽限期。
- 真实 OpenCode 1.18.25 创建 Session、停止 Worker、启动新 Worker并读取原 Session 成功，无模型调用。
- 镜像构建仍在基础镜像元数据阶段收到本机阿里云代理 403，未修改用户全局 Docker 配置。
