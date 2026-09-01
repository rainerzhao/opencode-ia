const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
function createWorkbenchServer({ config, promptRunner, logger = console }) {

const app = express();
const httpServer = http.createServer(app);
const wss = new WebSocket.Server({ server: httpServer });
let stopping = null;
const PUBLIC_RUNNER_ERRORS = Object.freeze({
  OPENCODE_TIMEOUT: 'OpenCode request timed out',
  OPENCODE_ABORTED: 'OpenCode request was cancelled',
  OPENCODE_OUTPUT_LIMIT: 'OpenCode response exceeded the output limit',
  OPENCODE_EXIT_ERROR: 'OpenCode process exited unsuccessfully',
  OPENCODE_EMPTY_RESPONSE: 'OpenCode returned no text response',
  OPENCODE_SPAWN_ERROR: 'OpenCode process could not be started'
});

// 中间件
app.use(express.json());
app.use(express.static(path.join(config.projectDir, 'public')));

// 文件上传配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const category = req.body.category || '';
    const uploadDir = path.join(config.knowledgeDir, category);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // 保留原文件名，中文文件名编码处理
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    cb(null, originalName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.md', '.txt', '.docx', '.pdf', '.json', '.csv'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的文件格式'));
    }
  }
});

// 会话管理
const sessions = new Map();

// API: 获取配置
app.get('/api/config', (req, res) => {
  // 读取 opencode 配置中的模型
  let model = 'unknown';
  try {
    const configPath = path.join(process.env.HOME, '.config', 'opencode', 'opencode.jsonc');
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      const match = content.match(/"model"\s*:\s*"([^"]+)"/);
      if (match) model = match[1];
    }
  } catch (e) {}

  res.json({
    maxSessions: config.maxSessions,
    activeSessions: sessions.size,
    opencodeCwd: config.opencodeCwd,
    model
  });
});

// API: 列出 Skills
app.get('/api/skills', (req, res) => {
  try {
    if (!fs.existsSync(config.skillsDir)) {
      return res.json([]);
    }
    const dirs = fs.readdirSync(config.skillsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => {
        const skillPath = path.join(config.skillsDir, d.name, 'SKILL.md');
        let description = '';
        if (fs.existsSync(skillPath)) {
          const content = fs.readFileSync(skillPath, 'utf-8');
          const match = content.match(/description:\s*(.+)/);
          if (match) description = match[1].trim();
        }
        return { name: d.name, description };
      });
    res.json(dirs);
  } catch (err) {
    res.json([]);
  }
});

// API: 会话列表
app.get('/api/sessions', (req, res) => {
  const list = [];
  sessions.forEach((info, id) => {
    list.push({ id, user: info.user, startTime: info.startTime });
  });
  res.json(list);
});

// API: 保存需求记录
app.post('/api/solutions', (req, res) => {
  const { title, description, solution, platforms, skills, chatHistory } = req.body;

  const record = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title,
    description,
    solution,
    platforms: platforms || [],
    skills: skills || [],
    chatHistory: chatHistory || [],
    createdAt: new Date().toISOString(),
    createdBy: 'anonymous'
  };

  // 保存到文件
  if (!fs.existsSync(config.solutionsDir)) {
    fs.mkdirSync(config.solutionsDir, { recursive: true });
  }

  const filePath = path.join(config.solutionsDir, `${record.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2));

  res.json({ success: true, id: record.id });
});

// API: 获取需求记录列表
app.get('/api/solutions', (req, res) => {
  try {
    if (!fs.existsSync(config.solutionsDir)) {
      return res.json([]);
    }
    const files = fs.readdirSync(config.solutionsDir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const content = fs.readFileSync(path.join(config.solutionsDir, f), 'utf-8');
        return JSON.parse(content);
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(files);
  } catch (err) {
    res.json([]);
  }
});

// API: 获取知识库目录结构
app.get('/api/knowledge/tree', (req, res) => {
  try {
    if (!fs.existsSync(config.knowledgeDir)) {
      fs.mkdirSync(config.knowledgeDir, { recursive: true });
    }
    const tree = buildKnowledgeTree(config.knowledgeDir);
    res.json(tree);
  } catch (err) {
    res.json([]);
  }
});

// 递归构建知识库目录树
function buildKnowledgeTree(dirPath, relativePath = '') {
  const items = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const itemPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      items.push({
        name: entry.name,
        type: 'directory',
        path: itemPath,
        children: buildKnowledgeTree(fullPath, itemPath)
      });
    } else if (entry.name.endsWith('.md')) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const title = entry.name.replace('.md', '');
      const preview = content.split('\n').filter(l => l.trim() && !l.startsWith('#'))[0] || '';
      items.push({
        name: title,
        type: 'file',
        path: itemPath,
        preview: preview.substring(0, 100),
        updatedAt: fs.statSync(fullPath).mtime.toISOString()
      });
    }
  }

  return items.sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return a.name.localeCompare(b.name);
  });
}

// API: 获取知识库文章内容
app.get('/api/knowledge/article', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) {
    return res.status(400).json({ error: 'path is required' });
  }

  const fullPath = path.join(config.knowledgeDir, filePath);
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  const content = fs.readFileSync(fullPath, 'utf-8');
  res.json({ path: filePath, content });
});

// API: 保存知识库文章
app.post('/api/knowledge/article', (req, res) => {
  const { filePath, content } = req.body;
  if (!filePath || content === undefined) {
    return res.status(400).json({ error: 'filePath and content are required' });
  }

  const fullPath = path.join(config.knowledgeDir, filePath);
  const dir = path.dirname(fullPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(fullPath, content, 'utf-8');
  res.json({ success: true });
});

// API: 新建知识库文章
app.post('/api/knowledge/article/new', (req, res) => {
  const { title, category, content } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'title is required' });
  }

  const fileName = `${title}.md`;
  const dirPath = category || '';
  const filePath = dirPath ? path.join(dirPath, fileName) : fileName;
  const fullPath = path.join(config.knowledgeDir, filePath);
  const dir = path.dirname(fullPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const mdContent = `# ${title}\n\n${content || ''}`;
  fs.writeFileSync(fullPath, mdContent, 'utf-8');

  res.json({ success: true, path: filePath });
});

// API: 删除知识库文章
app.delete('/api/knowledge/article', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) {
    return res.status(400).json({ error: 'path is required' });
  }

  const fullPath = path.join(config.knowledgeDir, filePath);
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }

  res.json({ success: true });
});

// API: 搜索知识库
app.get('/api/knowledge/search', (req, res) => {
  const query = (req.query.q || '').toLowerCase();
  if (!query) {
    return res.json([]);
  }

  const results = [];
  searchKnowledgeDir(config.knowledgeDir, query, results, '');
  res.json(results.slice(0, 20));
});

function searchKnowledgeDir(dirPath, query, results, relativePath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const itemPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      searchKnowledgeDir(fullPath, query, results, itemPath);
    } else if (entry.name.endsWith('.md')) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      if (content.toLowerCase().includes(query) || entry.name.toLowerCase().includes(query)) {
        const title = entry.name.replace('.md', '');
        const lines = content.split('\n');
        const matchLine = lines.find(l => l.toLowerCase().includes(query)) || '';
        results.push({
          title,
          path: itemPath,
          preview: matchLine.substring(0, 100) || content.substring(0, 100)
        });
      }
    }
  }
}

// API: 上传文件到知识库
app.post('/api/knowledge/upload', upload.array('files', 10), (req, res) => {
  try {
    const category = req.body.category || '';
    const results = [];

    for (const file of req.files) {
      const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const ext = path.extname(originalName).toLowerCase();
      const relativePath = category ? `${category}/${originalName}` : originalName;

      // 如果是 txt 或其他文本文件，转换为 md
      if (ext === '.txt') {
        const content = fs.readFileSync(file.path, 'utf-8');
        const mdPath = file.path.replace(ext, '.md');
        const title = originalName.replace(ext, '');
        fs.writeFileSync(mdPath, `# ${title}\n\n${content}`);
        fs.unlinkSync(file.path);
        results.push({ name: `${title}.md`, path: relativePath.replace(ext, '.md') });
      } else {
        results.push({ name: originalName, path: relativePath });
      }
    }

    res.json({ success: true, files: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: 从 URL 抓取内容
app.post('/api/knowledge/fetch-url', async (req, res) => {
  const { url, category } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'url is required' });
  }

  try {
    // 简单的 HTTP 抓取（实际项目中应使用更完善的爬虫）
    const response = await fetch(url);
    const html = await response.text();

    // 简单提取文本内容（去除 HTML 标签）
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // 生成文件名
    const urlObj = new URL(url);
    const title = urlObj.pathname.split('/').filter(Boolean).join('_') || 'web_content';
    const fileName = `${title}.md`;
    const filePath = category ? `${category}/${fileName}` : fileName;
    const fullPath = path.join(config.knowledgeDir, filePath);

    // 保存文件
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, `# ${title}\n\n来源: ${url}\n\n${text}`);

    res.json({ success: true, path: filePath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// WebSocket: 终端连接
wss.on('connection', (ws, req) => {
  if (sessions.size >= config.maxSessions) {
    ws.close(1013, 'MAX_SESSIONS_REACHED');
    return;
  }

  const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  logger.log(`[Session] 新建会话: ${sessionId}`);

  const session = {
    pid: process.pid,
    user: 'anonymous',
    startTime: new Date().toISOString(),
    activeAbortController: null
  };
  sessions.set(sessionId, session);

  ws.send(JSON.stringify({ type: 'connected', sessionId, pid: process.pid }));

  // 消息处理 - 使用 opencode run --format json
  ws.on('message', async (msg) => {
    try {
      const parsed = JSON.parse(msg.toString());
      if (parsed.type === 'input') {
        const input = parsed.data.trim();
        if (!input) return;

        if (session.activeAbortController) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'error',
              code: 'SESSION_BUSY',
              message: 'A request is already running for this session'
            }));
          }
          return;
        }

        logger.log(`[Session] ${sessionId} 收到输入`);

        // 发送思考中状态
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'thinking' }));
        }

        const controller = new AbortController();
        session.activeAbortController = controller;
        try {
          const result = await promptRunner.runPrompt(input, {
            signal: controller.signal,
            onEvent: (event) => {
              if (
                event.type === 'text' &&
                event.part &&
                typeof event.part.text === 'string' &&
                ws.readyState === WebSocket.OPEN
              ) {
                ws.send(JSON.stringify({ type: 'output', data: event.part.text }));
              }
            }
          });

          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'response', data: result.text }));
            ws.send(JSON.stringify({ type: 'done', code: 0 }));
          }
        } catch (error) {
          const code = Object.hasOwn(PUBLIC_RUNNER_ERRORS, error.code)
            ? error.code
            : 'OPENCODE_ERROR';
          logger.error(`[Session] ${sessionId} OpenCode 失败: ${code}`);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'error',
              code,
              message: PUBLIC_RUNNER_ERRORS[code] || 'OpenCode request failed'
            }));
          }
        } finally {
          if (session.activeAbortController === controller) {
            session.activeAbortController = null;
          }
        }
      }
    } catch (e) {
      logger.error(`[Session] ${sessionId} 消息处理失败`);
    }
  });

  ws.on('close', () => {
    session.activeAbortController?.abort();
    logger.log(`[Session] 会话关闭: ${sessionId}`);
    sessions.delete(sessionId);
  });
});

function start(port = config.port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    httpServer.once('error', onError);
    httpServer.listen(port, () => {
      httpServer.removeListener('error', onError);
      resolve(httpServer.address());
    });
  });
}

function stop() {
  if (stopping) return stopping;

  for (const session of sessions.values()) {
    session.activeAbortController?.abort();
  }
  for (const client of wss.clients) {
    client.close(1001, 'SERVER_SHUTDOWN');
  }

  stopping = new Promise((resolve, reject) => {
    let wsClosed = false;
    let httpClosed = !httpServer.listening;
    let firstError = null;
    const forceCloseTimer = setTimeout(() => {
      for (const client of wss.clients) client.terminate();
    }, 100);

    function finish() {
      if (!wsClosed || !httpClosed) return;
      clearTimeout(forceCloseTimer);
      if (firstError) reject(firstError);
      else resolve();
    }

    wss.close((error) => {
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') firstError ||= error;
      wsClosed = true;
      finish();
    });

    if (!httpClosed) {
      httpServer.close((error) => {
        if (error) firstError ||= error;
        httpClosed = true;
        finish();
      });
    }

    finish();
  });

  return stopping;
}

return { app, httpServer, start, stop, sessions };
}

module.exports = { createWorkbenchServer };
