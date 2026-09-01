# 团队 AI 工作台

基于 OpenCode 的多人协作 AI 工作台，团队成员通过浏览器即可使用 OpenCode，共享 Skills 和工作流。

## 功能特性

- 🖥️ 浏览器终端：无需 SSH，直接在网页中使用 OpenCode
- 📂 内部平台快捷入口：数据平台、防火墙、情报平台、工单系统
- 🛠️ Skills 管理：查看和使用团队共享的 Skills
- 👥 多会话支持：每人独立会话，互不干扰
- ⚙️ 个性化设置：字体大小、主题切换

## 快速开始

### 1. 服务器安装 OpenCode

```bash
# 安装 Node.js (如果没有)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 安装 OpenCode
npm install -g opencode
```

### 2. 创建团队工作目录

```bash
# 创建目录
sudo mkdir -p /opt/team-opencode/.opencode/skills
sudo chown -R $USER:$USER /opt/team-opencode

# 进入目录
cd /opt/team-opencode

# 初始化 OpenCode 配置
cat > opencode.jsonc << 'EOF'
{
  "$schema": "https://opencode.ai/config.json",
  "model": "openai/gpt-4o",
  "skills": {
    "paths": [".opencode/skills"]
  }
}
EOF
```

### 3. 安装工作台

```bash
# 进入工作台目录
cd /path/to/opencode-ia

# 安装依赖
npm install
```

### 4. 启动服务

```bash
# 设置环境变量（可选）
export PORT=3000
export OPENCODE_CWD=/opt/team-opencode
export MAX_SESSIONS=20

# 启动
npm start
```

### 5. 访问

打开浏览器访问: `http://your-server:3000`

## 配置

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| PORT | 服务端口 | 3000 |
| OPENCODE_CWD | OpenCode 工作目录 | /opt/team-opencode |
| MAX_SESSIONS | 最大并发会话数 | 20 |

### 添加 Skill

```bash
# 在服务器上创建 Skill
mkdir -p /opt/team-opencode/.opencode/skills/my-skill

# 创建 SKILL.md
cat > /opt/team-opencode/.opencode/skills/my-skill/SKILL.md << 'EOF'
---
name: my-skill
description: 我的自定义 Skill，用于...
---

# My Skill

具体使用说明...
EOF
```

创建后，刷新工作台页面即可在左侧 Skills 面板看到。

### 添加内部平台链接

编辑 `public/index.html`，在 `platforms` 区域添加：

```html
<a href="#" class="platform-link" data-url="https://your-platform.internal.com">
  <span class="icon">🔧</span> 你的平台
</a>
```

## 生产部署

### 使用 PM2 守护进程

```bash
npm install -g pm2

# 启动
pm2 start server.js --name opencode-workbench

# 设置开机自启
pm2 startup
pm2 save
```

### 使用 Nginx 反向代理

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### HTTPS 配置

```bash
# 安装 certbot
sudo apt install certbot python3-certbot-nginx

# 获取证书
sudo certbot --nginx -d your-domain.com
```

## 目录结构

```
opencode-ia/
├── server.js              # 后端服务
├── package.json           # 依赖配置
├── public/
│   ├── index.html         # 主页面
│   ├── style.css          # 样式
│   └── app.js             # 前端逻辑
└── README.md              # 说明文档
```

## 常见问题

### Q: OpenCode 命令找不到

确保 OpenCode 已安装并在 PATH 中：

```bash
which opencode
# 如果没有，添加到 PATH
export PATH=$PATH:/usr/local/bin
```

### Q: WebSocket 连接失败

检查防火墙是否开放了端口：

```bash
sudo ufw allow 3000
```

### Q: 终端显示乱码

确保服务器支持 UTF-8：

```bash
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8
```

## 团队协作流程

1. **管理员**部署工作台，配置模型 API Key
2. **团队成员**通过浏览器访问，创建会话
3. **任何人**可以创建新 Skill，存入共享目录
4. **所有人**立即可以使用新 Skill
5. **工作流**通过组合多个 Skill 实现

## 扩展方向

- [ ] 接入更多内部平台
- [ ] 添加知识库检索能力
- [ ] 封装浏览器自动化为 MCP Server
- [ ] 添加会话历史记录
- [ ] 添加权限控制
