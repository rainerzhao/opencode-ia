const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const crypto = require('node:crypto');
const multer = require('multer');
const { resolveWithinRoot, validateFileName } = require('./security/path-policy');
const { fetchAllowedText } = require('./security/url-policy');

function createWorkbenchServer({
  config,
  promptRunner,
  logger = console,
  urlFetchOptions = {},
  fetchAllowedTextImpl = fetchAllowedText
}) {

const app = express();
const httpServer = http.createServer(app);
const wss = new WebSocket.Server({ server: httpServer });
let lifecycle = 'idle';
let starting = null;
let rejectStarting = null;
let startErrorHandler = null;
let stopping = null;
const activeHttpControllers = new Set();
const PUBLIC_RUNNER_ERRORS = Object.freeze({
  OPENCODE_TIMEOUT: 'OpenCode request timed out',
  OPENCODE_ABORTED: 'OpenCode request was cancelled',
  OPENCODE_OUTPUT_LIMIT: 'OpenCode response exceeded the output limit',
  OPENCODE_EXIT_ERROR: 'OpenCode process exited unsuccessfully',
  OPENCODE_EMPTY_RESPONSE: 'OpenCode returned no text response',
  OPENCODE_SPAWN_ERROR: 'OpenCode process could not be started'
});

// 中间件
app.use((req, res, next) => {
  req.requestId = crypto.randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
});
app.use(express.json());
app.use(express.static(path.join(config.projectDir, 'public')));

function apiError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function safePath(root, relativePath, options) {
  try {
    return resolveWithinRoot(root, relativePath, options);
  } catch {
    throw apiError('UNSAFE_PATH', 'The requested path is not allowed');
  }
}

function safeFileName(name) {
  try {
    return validateFileName(name);
  } catch {
    throw apiError('UNSAFE_FILE_NAME', 'The requested file name is not allowed');
  }
}

function safeCategory(root, category) {
  if (category === undefined || category === null || category === '') {
    return { absolute: safePath(root, '.'), relative: '' };
  }
  if (typeof category !== 'string' || category.includes('\\')) {
    throw apiError('UNSAFE_PATH', 'The requested path is not allowed');
  }
  const segments = category.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw apiError('UNSAFE_PATH', 'The requested path is not allowed');
  }
  const normalized = segments.map(safeFileName).join('/');
  return { absolute: safePath(root, normalized), relative: normalized };
}

// 文件上传配置
fs.mkdirSync(config.uploadTempDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadTempDir),
  filename: (_req, _file, cb) => cb(null, crypto.randomUUID())
});

const upload = multer({
  preservePath: true,
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }
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
        const skillPath = safePath(config.skillsDir, `${safeFileName(d.name)}/SKILL.md`, { extensions: ['.md'] });
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

  if (!fs.existsSync(config.solutionsDir)) {
    fs.mkdirSync(config.solutionsDir, { recursive: true });
  }

  const filePath = safePath(config.solutionsDir, `${safeFileName(record.id)}.json`, { extensions: ['.json'] });
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
        const content = fs.readFileSync(safePath(config.solutionsDir, safeFileName(f), { extensions: ['.json'] }), 'utf-8');
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
    let fullPath;
    try {
      fullPath = safePath(config.knowledgeDir, relativePath ? `${relativePath}/${entry.name}` : entry.name);
    } catch {
      continue;
    }
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
    throw apiError('INVALID_REQUEST', 'path is required');
  }

  const fullPath = safePath(config.knowledgeDir, filePath, { extensions: ['.md'] });
  if (!fs.existsSync(fullPath)) {
    throw apiError('NOT_FOUND', 'File not found', 404);
  }

  const content = fs.readFileSync(fullPath, 'utf-8');
  res.json({ path: filePath, content });
});

// API: 保存知识库文章
app.post('/api/knowledge/article', (req, res) => {
  const { filePath, content } = req.body;
  if (!filePath || typeof content !== 'string') {
    throw apiError('INVALID_REQUEST', 'filePath and string content are required');
  }

  const fullPath = safePath(config.knowledgeDir, filePath, { extensions: ['.md'] });
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
  if (typeof title !== 'string' || !title || (content !== undefined && typeof content !== 'string')) {
    throw apiError('INVALID_REQUEST', 'title and content must be strings');
  }

  const fileName = safeFileName(`${title}.md`);
  const destination = safeCategory(config.knowledgeDir, category);
  const filePath = destination.relative ? `${destination.relative}/${fileName}` : fileName;
  const fullPath = safePath(config.knowledgeDir, filePath, { extensions: ['.md'] });
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
    throw apiError('INVALID_REQUEST', 'path is required');
  }

  const fullPath = safePath(config.knowledgeDir, filePath, { extensions: ['.md'] });
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
    let fullPath;
    try {
      fullPath = safePath(config.knowledgeDir, relativePath ? `${relativePath}/${entry.name}` : entry.name);
    } catch {
      continue;
    }
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

function removeExplicitFiles(files) {
  for (const filePath of files) {
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') logger.error('[Upload] temporary file cleanup failed');
    }
  }
}

function decodeUploadName(originalName) {
  return Buffer.from(originalName, 'latin1').toString('utf8');
}

// API: 上传文件到知识库
app.post('/api/knowledge/upload', (req, res, next) => {
  upload.array('files', 10)(req, res, (multerError) => {
    const temporaryFiles = (req.files || []).map((file) => file.path);
    if (multerError) {
      removeExplicitFiles(temporaryFiles);
      next(apiError(
        multerError.code === 'LIMIT_FILE_SIZE' ? 'UPLOAD_TOO_LARGE' : 'INVALID_UPLOAD',
        multerError.code === 'LIMIT_FILE_SIZE'
          ? 'Uploaded file exceeds the size limit'
          : 'Upload could not be processed'
      ));
      return;
    }

    const promoted = [];
    const backups = [];
    try {
      if (!req.files?.length) throw apiError('INVALID_UPLOAD', 'At least one file is required');
      const category = safeCategory(config.knowledgeDir, req.body.category);
      const allowedExtensions = new Set(['.md', '.txt', '.docx', '.pdf', '.json', '.csv']);
      const targets = new Set();
      const entries = req.files.map((file) => {
        const originalName = safeFileName(decodeUploadName(file.originalname));
        const extension = path.extname(originalName).toLowerCase();
        if (!allowedExtensions.has(extension)) {
          throw apiError('UPLOAD_EXTENSION_NOT_ALLOWED', 'Uploaded file extension is not allowed');
        }
        const finalName = extension === '.txt'
          ? safeFileName(`${originalName.slice(0, -extension.length)}.md`)
          : originalName;
        const relativePath = category.relative ? `${category.relative}/${finalName}` : finalName;
        const target = safePath(config.knowledgeDir, relativePath);
        if (targets.has(target)) throw apiError('DUPLICATE_UPLOAD', 'Upload contains duplicate destinations');
        targets.add(target);
        return { file, originalName, extension, finalName, relativePath, target };
      });

      fs.mkdirSync(category.absolute, { recursive: true });
      for (const entry of entries) {
        if (fs.existsSync(entry.target)) {
          const backup = safePath(config.uploadTempDir, crypto.randomUUID());
          fs.renameSync(entry.target, backup);
          backups.push({ target: entry.target, backup });
        }

        if (entry.extension === '.txt') {
          const content = fs.readFileSync(entry.file.path, 'utf8');
          const title = entry.finalName.slice(0, -3);
          fs.writeFileSync(entry.target, `# ${title}\n\n${content}`, { flag: 'wx' });
          promoted.push(entry.target);
          fs.unlinkSync(entry.file.path);
        } else {
          fs.renameSync(entry.file.path, entry.target);
          promoted.push(entry.target);
        }
      }

      removeExplicitFiles(backups.map(({ backup }) => backup));
      res.json({
        success: true,
        files: entries.map(({ finalName, relativePath }) => ({ name: finalName, path: relativePath }))
      });
    } catch (error) {
      removeExplicitFiles(promoted);
      for (const { target, backup } of backups.reverse()) {
        try {
          if (fs.existsSync(backup)) fs.renameSync(backup, target);
        } catch {
          logger.error('[Upload] destination rollback failed');
        }
      }
      removeExplicitFiles(temporaryFiles);
      removeExplicitFiles(backups.map(({ backup }) => backup));
      next(error);
    }
  });
});

// API: 从 URL 抓取内容
app.post('/api/knowledge/fetch-url', async (req, res, next) => {
  const { url, category } = req.body;
  if (typeof url !== 'string' || !url) {
    next(apiError('INVALID_REQUEST', 'url is required'));
    return;
  }

  const controller = new AbortController();
  const abortIfClientClosed = () => {
    if (!res.writableEnded) controller.abort();
  };
  activeHttpControllers.add(controller);
  res.once('close', abortIfClientClosed);
  try {
    const destination = safeCategory(config.knowledgeDir, category);
    const fetched = await fetchAllowedTextImpl(url, {
      ...urlFetchOptions,
      allowedHosts: config.fetchAllowedHosts,
      signal: controller.signal
    });

    const text = fetched.text
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const finalUrl = new URL(fetched.finalUrl);
    let title = finalUrl.pathname.split('/').filter(Boolean).join('_') || 'web_content';
    try { title = decodeURIComponent(title); } catch {}
    title = title
      .normalize('NFC')
      .replace(/[\u0000-\u001f\u007f/\\]/g, '_')
      .replace(/^\.+|\.+$/g, '')
      .slice(0, 160) || 'web_content';
    const fileName = safeFileName(`${title}.md`);
    const filePath = destination.relative ? `${destination.relative}/${fileName}` : fileName;
    const fullPath = safePath(config.knowledgeDir, filePath, { extensions: ['.md'] });

    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, `# ${title}\n\n来源: ${fetched.finalUrl}\n\n${text}`);

    res.json({ success: true, path: filePath });
  } catch (error) {
    if (!res.headersSent && !res.destroyed) {
      next(error);
    }
  } finally {
    res.removeListener('close', abortIfClientClosed);
    activeHttpControllers.delete(controller);
  }
});

app.use((error, req, res, _next) => {
  if (res.headersSent || res.destroyed) return;
  const knownStatus = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599;
  const status = knownStatus ? error.status : 500;
  const code = typeof error.code === 'string' && (knownStatus || error.code.startsWith('URL_'))
    ? error.code
    : 'INTERNAL_ERROR';
  const message = knownStatus && typeof error.message === 'string'
    ? error.message
    : 'The request could not be completed';
  if (status >= 500) logger.error(`[HTTP] ${req.requestId} ${code}`);
  res.status(status).json({ error: { code, message, requestId: req.requestId } });
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

  function sendSafeError(code, message) {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'error', code, message }));
  }

  // 消息处理 - 使用 opencode run --format json
  ws.on('message', async (msg) => {
    try {
      let parsed;
      try {
        parsed = JSON.parse(msg.toString());
      } catch {
        sendSafeError('INVALID_MESSAGE', 'Message must be valid JSON input');
        return;
      }

      if (!parsed || parsed.type !== 'input' || typeof parsed.data !== 'string') {
        sendSafeError('INVALID_MESSAGE', 'Message must contain string input data');
        return;
      }

      const input = parsed.data.trim();
      if (!input) return;

      if (session.activeAbortController) {
        sendSafeError('SESSION_BUSY', 'A request is already running for this session');
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
        sendSafeError(code, PUBLIC_RUNNER_ERRORS[code] || 'OpenCode request failed');
      } finally {
        if (session.activeAbortController === controller) {
          session.activeAbortController = null;
        }
      }
    } catch (e) {
      logger.error(`[Session] ${sessionId} 消息处理失败`);
      sendSafeError('INVALID_MESSAGE', 'Message could not be processed');
    }
  });

  ws.on('close', () => {
    session.activeAbortController?.abort();
    logger.log(`[Session] 会话关闭: ${sessionId}`);
    sessions.delete(sessionId);
  });
});

function start(port = config.port, host) {
  if (lifecycle === 'running') return Promise.resolve(httpServer.address());
  if (lifecycle === 'starting') return starting;
  if (lifecycle === 'stopping' || lifecycle === 'stopped') {
    const error = new Error('Workbench server has been stopped');
    error.code = 'SERVER_STOPPED';
    return Promise.reject(error);
  }

  lifecycle = 'starting';
  starting = new Promise((resolve, reject) => {
    rejectStarting = reject;
    startErrorHandler = (error) => {
      lifecycle = 'idle';
      starting = null;
      rejectStarting = null;
      startErrorHandler = null;
      reject(error);
    };
    httpServer.once('error', startErrorHandler);
    const onListening = () => {
      if (lifecycle !== 'starting') return;
      if (startErrorHandler) httpServer.removeListener('error', startErrorHandler);
      rejectStarting = null;
      startErrorHandler = null;
      lifecycle = 'running';
      resolve(httpServer.address());
    };
    if (host) httpServer.listen(port, host, onListening);
    else httpServer.listen(port, onListening);
  });
  return starting;
}

function stop() {
  if (stopping) return stopping;

  if (lifecycle === 'starting' && rejectStarting) {
    if (startErrorHandler) httpServer.removeListener('error', startErrorHandler);
    const error = new Error('Workbench server stopped before startup completed');
    error.code = 'SERVER_STOPPED';
    rejectStarting(error);
    rejectStarting = null;
    startErrorHandler = null;
  }
  lifecycle = 'stopping';

  for (const controller of activeHttpControllers) controller.abort();
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
      httpServer.closeAllConnections?.();
    }, 100);
    forceCloseTimer.unref?.();

    const settlementTimer = setTimeout(() => {
      if (wsClosed && httpClosed) return;
      const error = new Error('Workbench server shutdown timed out');
      error.code = 'SERVER_STOP_TIMEOUT';
      firstError ||= error;
      wsClosed = true;
      httpClosed = true;
      finish();
    }, 1000);
    settlementTimer.unref?.();

    function finish() {
      if (!wsClosed || !httpClosed) return;
      clearTimeout(forceCloseTimer);
      clearTimeout(settlementTimer);
      lifecycle = 'stopped';
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
