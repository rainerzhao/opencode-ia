// 应用状态
const state = {
  ws: null,
  term: null,
  fitAddon: null,
  connected: false,
  sessionId: null,
  currentPage: 'home',
  chatHistory: [],
  skills: [],
  faqConnected: false,
  faqWs: null
};

// DOM 元素
const els = {
  // 导航
  navItems: document.querySelectorAll('.nav-item'),
  quickCards: document.querySelectorAll('.quick-card'),
  pages: document.querySelectorAll('.page'),
  pageTitle: document.getElementById('pageTitle'),
  pageDesc: document.getElementById('pageDesc'),

  // AI 平台
  chatMessages: document.getElementById('chatMessages'),
  chatInput: document.getElementById('chatInput'),
  sendBtn: document.getElementById('sendBtn'),
  clearChatBtn: document.getElementById('clearChatBtn'),
  recordBtn: document.getElementById('recordBtn'),
  newSessionBtn: document.getElementById('newSessionBtn'),
  statusBadge: document.getElementById('statusBadge'),
  modelBadge: document.getElementById('modelBadge'),
  terminal: document.getElementById('terminal'),
  terminalPlaceholder: document.getElementById('terminalPlaceholder'),
  terminalStatus: document.getElementById('terminalStatus'),
  skillsList: document.getElementById('skillsList'),
  skillCount: document.getElementById('skillCount'),

  // 需求方案库
  solutionsList: document.getElementById('solutionsList'),

  // FAQ 浮动
  faqFab: document.getElementById('faqFab'),
  faqChat: document.getElementById('faqChat'),
  faqClose: document.getElementById('faqClose'),
  faqMessages: document.getElementById('faqMessages'),
  faqInput: document.getElementById('faqInput'),
  faqSendBtn: document.getElementById('faqSendBtn'),

  // 弹窗
  recordModal: document.getElementById('recordModal'),
  closeModal: document.getElementById('closeModal'),
  cancelRecord: document.getElementById('cancelRecord'),
  confirmRecord: document.getElementById('confirmRecord'),
  recordTitle: document.getElementById('recordTitle'),
  recordDesc: document.getElementById('recordDesc'),
  recordSolution: document.getElementById('recordSolution'),
  recordSkills: document.getElementById('recordSkills')
};

// 页面描述
const pageDescs = {
  home: '全组口袋力量，经验平权，快速导航',
  navigation: '管理团队共享的导航链接',
  ai: '与 AI 对话，处理客户问题，检索知识库',
  faq: '常见问题与智能路由',
  solutions: '沉淀需求方案，知识复用',
  skills: '团队 AI 能力资产库',
  knowledge: '在线编辑和管理知识库文档'
};

// 初始化
function init() {
  initNavigation();
  initChat();
  initFAQ();
  initModal();
  initKnowledge();
  loadSkills();
  loadConfig(); // 加载配置（模型名等）
  connect(); // 页面加载时自动连接
}

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    if (config.model && els.modelBadge) {
      // 简化显示，去掉 provider 前缀
      els.modelBadge.textContent = config.model.split('/').pop();
    }
  } catch (e) {
    console.error('加载配置失败:', e);
  }
}

// 导航
function initNavigation() {
  els.navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const page = item.dataset.page;
      switchPage(page);
    });
  });

  els.quickCards.forEach(card => {
    card.addEventListener('click', () => {
      const page = card.dataset.page;
      switchPage(page);
    });
  });
}

function switchPage(page) {
  state.currentPage = page;

  // 更新导航
  els.navItems.forEach(item => {
    item.classList.toggle('active', item.dataset.page === page);
  });

  // 更新页面
  els.pages.forEach(p => {
    p.classList.toggle('active', p.id === `page-${page}`);
  });

  // 更新标题
  els.pageTitle.textContent = getPageTitle(page);
  els.pageDesc.textContent = pageDescs[page] || '';

  // 显示/隐藏新建会话按钮
  els.newSessionBtn.style.display = page === 'ai' ? 'inline-flex' : 'none';
}

function getPageTitle(page) {
  const titles = {
    home: '工作台首页',
    navigation: '导航管理',
    ai: 'AI 平台',
    faq: 'FAQ & 路由',
    solutions: '需求方案库',
    skills: 'Skill 资产',
    knowledge: '知识库'
  };
  return titles[page] || '工作台';
}

// 聊天功能
function initChat() {
  els.sendBtn.addEventListener('click', sendMessage);
  els.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // 自动调整输入框高度
  els.chatInput.addEventListener('input', () => {
    els.chatInput.style.height = 'auto';
    els.chatInput.style.height = Math.min(els.chatInput.scrollHeight, 120) + 'px';
  });

  els.clearChatBtn.addEventListener('click', clearChat);
  els.newSessionBtn.addEventListener('click', newSession);
  els.recordBtn.addEventListener('click', openRecordModal);

  // 快捷入口点击
  document.querySelectorAll('.tip-card').forEach(card => {
    card.addEventListener('click', () => {
      els.chatInput.value = card.textContent.trim();
      els.chatInput.focus();
    });
  });
}

function sendMessage() {
  const text = els.chatInput.value.trim();
  if (!text) return;

  // 添加用户消息
  addMessage('user', text);
  state.chatHistory.push({ role: 'user', content: text });

  // 清空输入
  els.chatInput.value = '';
  els.chatInput.style.height = 'auto';

  // 启用记录按钮
  els.recordBtn.disabled = false;

  // 发送到 WebSocket
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: 'input', data: text + '\n' }));
  } else {
    // 存储消息，连接后发送
    state.pendingMessage = text;
    connect();
  }
}

function addMessage(role, content) {
  // 移除欢迎消息
  const welcome = els.chatMessages.querySelector('.welcome-message');
  if (welcome) welcome.remove();

  const div = document.createElement('div');
  div.className = `message ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = role === 'user' ? '👤' : '🤖';

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  contentDiv.textContent = content;

  div.appendChild(avatar);
  div.appendChild(contentDiv);
  els.chatMessages.appendChild(div);

  // 滚动到底部
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

function clearChat() {
  els.chatMessages.innerHTML = `
    <div class="welcome-message">
      <div class="welcome-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="url(#welcomeGrad)" stroke-width="1.5">
          <path d="M12 2L2 7L12 12L22 7L12 2Z"/>
          <path d="M2 17L12 22L22 17"/>
          <path d="M2 12L12 17L22 12"/>
          <defs>
            <linearGradient id="welcomeGrad" x1="2" y1="2" x2="22" y2="22">
              <stop offset="0%" stop-color="#00d4ff"/>
              <stop offset="100%" stop-color="#7b2fff"/>
            </linearGradient>
          </defs>
        </svg>
      </div>
      <h3>AI 方案工作台</h3>
      <p>我可以帮你处理客户问题、查询数据、检索知识库</p>
      <div class="welcome-tips">
        <div class="tip-card">GPU 选型咨询</div>
        <div class="tip-card">信创迁移方案</div>
        <div class="tip-card">架构评审辅助</div>
      </div>
    </div>
  `;
  state.chatHistory = [];
  els.recordBtn.disabled = true;
}

// 终端功能
function initTerminal() {
  // 延迟初始化，直到首次使用
}

function initTerminalInstance() {
  if (state.term) return;

  state.term = new Terminal({
    fontSize: 13,
    fontFamily: "'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace",
    theme: {
      background: '#0d1117',
      foreground: '#c9d1d9',
      cursor: '#00d4ff',
      selectionBackground: '#00d4ff30'
    },
    cursorBlink: true,
    cursorStyle: 'bar'
  });

  state.fitAddon = new FitAddon.FitAddon();
  state.term.loadAddon(state.fitAddon);

  els.terminal.innerHTML = '';
  state.term.open(els.terminal);
  state.fitAddon.fit();

  // 输入转发
  state.term.onData((data) => {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ type: 'input', data }));
    }
  });

  // 监听窗口大小
  window.addEventListener('resize', () => {
    if (state.fitAddon) {
      state.fitAddon.fit();
    }
  });

  // 显示终端
  els.terminalPlaceholder.style.display = 'none';
  els.terminal.style.display = 'block';
  els.terminalStatus.textContent = '运行中';
  els.terminalStatus.style.color = 'var(--success)';
}

// WebSocket 连接
function connect() {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) return;

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  state.ws = new WebSocket(`${protocol}//${location.host}`);

  state.ws.onopen = () => {
    console.log('WebSocket 已连接');
    // 如果有待发送的消息，发送第一条
    if (state.pendingMessage) {
      state.ws.send(JSON.stringify({ type: 'input', data: state.pendingMessage + '\n' }));
      state.pendingMessage = null;
    }
  };

  state.ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      handleMessage(msg);
    } catch (err) {
      console.error('解析消息失败:', err);
    }
  };

  state.ws.onclose = () => {
    console.log('WebSocket 已断开');
    updateStatus(false);
    setTimeout(connect, 3000);
  };

  state.ws.onerror = (err) => {
    console.error('WebSocket 错误:', err);
  };
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'connected':
      state.sessionId = msg.sessionId;
      state.connected = true;
      updateStatus(true);
      initTerminalInstance();
      addMessage('assistant', `会话已启动，可以输入问题了。`);
      break;

    case 'thinking':
      addMessage('assistant', '正在思考中...');
      break;

    case 'response':
      // 显示 AI 完整回复
      addMessage('assistant', msg.data);
      break;

    case 'output':
      // 兼容旧格式
      if (state.term) {
        state.term.write(msg.data);
      }
      break;

    case 'done':
      console.log('OpenCode 完成:', msg.code);
      break;

    case 'error':
      addMessage('assistant', `错误: ${msg.message}`);
      break;

    case 'exit':
      state.connected = false;
      updateStatus(false);
      addMessage('assistant', `会话已结束 (code: ${msg.code})`);
      break;
  }
}

function updateStatus(connected) {
  state.connected = connected;
  els.statusBadge.textContent = connected ? '已连接' : '未连接';
  els.statusBadge.className = 'status-badge' + (connected ? ' connected' : '');
}

function newSession() {
  if (state.ws) {
    state.ws.close();
    state.ws = null;
  }
  state.term = null;
  state.sessionId = null;
  els.terminal.style.display = 'none';
  els.terminalPlaceholder.style.display = 'block';
  els.terminalStatus.textContent = '未启动';
  els.terminalStatus.style.color = '';
  connect();
}

// FAQ 浮动机器人
function initFAQ() {
  els.faqFab.addEventListener('click', toggleFAQChat);
  els.faqClose.addEventListener('click', closeFAQChat);
  els.faqSendBtn.addEventListener('click', sendFaqMessage);
  els.faqInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      sendFaqMessage();
    }
  });

  // 快捷问题点击
  document.querySelectorAll('.faq-suggestion').forEach(s => {
    s.addEventListener('click', () => {
      els.faqInput.value = s.dataset.q;
      sendFaqMessage();
    });
  });
}

function toggleFAQChat() {
  els.faqChat.classList.toggle('active');
}

function closeFAQChat() {
  els.faqChat.classList.remove('active');
}

function sendFaqMessage() {
  const text = els.faqInput.value.trim();
  if (!text) return;

  // 添加用户消息
  addFaqMessage('user', text);

  // 清空输入
  els.faqInput.value = '';

  // 模拟 AI 回复（实际应连接 OpenCode）
  setTimeout(() => {
    addFaqMessage('assistant', `正在从知识库中检索"${text}"相关信息...`);
  }, 500);
}

function addFaqMessage(role, content) {
  // 移除欢迎消息
  const welcome = els.faqMessages.querySelector('.faq-welcome');
  if (welcome) welcome.remove();

  const div = document.createElement('div');
  div.className = `faq-message ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'faq-message-avatar';
  avatar.textContent = role === 'user' ? '👤' : '🤖';

  const contentDiv = document.createElement('div');
  contentDiv.className = 'faq-message-content';
  contentDiv.textContent = content;

  div.appendChild(avatar);
  div.appendChild(contentDiv);
  els.faqMessages.appendChild(div);

  // 滚动到底部
  els.faqMessages.scrollTop = els.faqMessages.scrollHeight;
}

// Skills 加载
async function loadSkills() {
  try {
    const res = await fetch('/api/skills');
    state.skills = await res.json();

    if (state.skills.length === 0) {
      els.skillsList.innerHTML = '<div class="skill-tag">暂无 Skills</div>';
      els.skillCount.textContent = '0';
      return;
    }

    els.skillsList.innerHTML = state.skills.map(s =>
      `<div class="skill-tag" title="${s.description}">${s.name}</div>`
    ).join('');
    els.skillCount.textContent = state.skills.length;
  } catch (err) {
    els.skillsList.innerHTML = '<div class="skill-tag">加载失败</div>';
  }
}

// 需求记录弹窗
function initModal() {
  els.closeModal.addEventListener('click', closeRecordModal);
  els.cancelRecord.addEventListener('click', closeRecordModal);
  els.confirmRecord.addEventListener('click', saveRecord);

  // 点击弹窗外部关闭
  els.recordModal.addEventListener('click', (e) => {
    if (e.target === els.recordModal) {
      closeRecordModal();
    }
  });
}

function openRecordModal() {
  // 从聊天历史生成总结
  if (state.chatHistory.length > 0) {
    const lastUserMsg = state.chatHistory.filter(m => m.role === 'user').pop();
    if (lastUserMsg) {
      els.recordTitle.value = lastUserMsg.content.substring(0, 50);
      els.recordDesc.value = state.chatHistory.map(m =>
        `${m.role === 'user' ? '用户' : 'AI'}: ${m.content}`
      ).join('\n');
    }
  }

  // 显示使用的 Skills
  els.recordSkills.innerHTML = state.skills.slice(0, 3).map(s =>
    `<span class="tag">${s.name}</span>`
  ).join('');

  els.recordModal.classList.add('active');
}

function closeRecordModal() {
  els.recordModal.classList.remove('active');
}

function saveRecord() {
  const record = {
    id: Date.now(),
    title: els.recordTitle.value,
    description: els.recordDesc.value,
    solution: els.recordSolution.value,
    date: new Date().toISOString(),
    chatHistory: state.chatHistory
  };

  // 保存到 localStorage
  const records = JSON.parse(localStorage.getItem('solutions') || '[]');
  records.unshift(record);
  localStorage.setItem('solutions', JSON.stringify(records));

  // 更新列表
  renderSolutions();

  // 关闭弹窗
  closeRecordModal();

  // 提示
  alert('需求已记录到需求方案库');
}

function renderSolutions() {
  const records = JSON.parse(localStorage.getItem('solutions') || '[]');

  if (records.length === 0) {
    els.solutionsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
        </div>
        <p>暂无需求记录</p>
        <p class="empty-hint">在 AI 平台对话后点击「记录需求」即可保存</p>
      </div>
    `;
    return;
  }

  els.solutionsList.innerHTML = records.map(r => `
    <div class="solution-item" style="padding: 16px; border-bottom: 1px solid var(--border); transition: background 0.2s;" onmouseover="this.style.background='var(--bg-card-hover)'" onmouseout="this.style.background='transparent'">
      <div style="font-weight: 500; margin-bottom: 8px; color: var(--text-primary);">${r.title}</div>
      <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 8px;">${r.description.substring(0, 100)}...</div>
      <div style="font-size: 12px; color: var(--text-muted);">${new Date(r.date).toLocaleString()}</div>
    </div>
  `).join('');
}

// 知识库功能
function initKnowledge() {
  const addArticleBtn = document.getElementById('addArticleBtn');
  const cancelEditBtn = document.getElementById('cancelEditBtn');
  const saveEditBtn = document.getElementById('saveEditBtn');
  const knowledgeEditor = document.getElementById('knowledgeEditor');
  const knowledgeList = document.getElementById('knowledgeList');
  const editorTitle = document.getElementById('editorTitle');
  const editorContent = document.getElementById('editorContent');
  const kbSearchInput = document.getElementById('kbSearchInput');
  const uploadBtn = document.getElementById('uploadBtn');
  const uploadZone = document.getElementById('uploadZone');
  const uploadDrop = document.getElementById('uploadDrop');
  const fileInput = document.getElementById('fileInput');
  const uploadList = document.getElementById('uploadList');
  const cancelUploadBtn = document.getElementById('cancelUploadBtn');
  const confirmUploadBtn = document.getElementById('confirmUploadBtn');
  const uploadCategory = document.getElementById('uploadCategory');

  let selectedFiles = [];

  if (addArticleBtn) {
    addArticleBtn.addEventListener('click', () => {
      knowledgeList.style.display = 'none';
      knowledgeEditor.style.display = 'flex';
      editorTitle.value = '';
      editorContent.value = '';
      editorTitle.focus();
    });
  }

  if (cancelEditBtn) {
    cancelEditBtn.addEventListener('click', () => {
      knowledgeList.style.display = 'block';
      knowledgeEditor.style.display = 'none';
    });
  }

  if (saveEditBtn) {
    saveEditBtn.addEventListener('click', async () => {
      const title = editorTitle.value.trim();
      const content = editorContent.value.trim();
      if (!title) {
        alert('请输入标题');
        return;
      }

      try {
        await fetch('/api/knowledge/article/new', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content, category: '' })
        });
      } catch (err) {
        console.error('保存失败:', err);
      }

      await loadKnowledgeTree();
      knowledgeList.style.display = 'block';
      knowledgeEditor.style.display = 'none';
    });
  }

  // 上传功能
  if (uploadBtn) {
    uploadBtn.addEventListener('click', () => {
      uploadZone.style.display = uploadZone.style.display === 'none' ? 'block' : 'none';
      selectedFiles = [];
      uploadList.innerHTML = '';
    });
  }

  if (uploadDrop) {
    uploadDrop.addEventListener('click', () => fileInput.click());

    uploadDrop.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadDrop.classList.add('dragover');
    });

    uploadDrop.addEventListener('dragleave', () => {
      uploadDrop.classList.remove('dragover');
    });

    uploadDrop.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadDrop.classList.remove('dragover');
      handleFiles(e.dataTransfer.files);
    });
  }

  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      handleFiles(e.target.files);
    });
  }

  function handleFiles(files) {
    for (const file of files) {
      if (!selectedFiles.find(f => f.name === file.name)) {
        selectedFiles.push(file);
      }
    }
    renderUploadList();
  }

  function renderUploadList() {
    uploadList.innerHTML = selectedFiles.map((file, i) => `
      <div class="upload-item">
        <span class="upload-item-name">${file.name}</span>
        <span class="upload-item-size">${formatFileSize(file.size)}</span>
        <span class="upload-item-remove" data-index="${i}">×</span>
      </div>
    `).join('');

    uploadList.querySelectorAll('.upload-item-remove').forEach(el => {
      el.addEventListener('click', () => {
        selectedFiles.splice(parseInt(el.dataset.index), 1);
        renderUploadList();
      });
    });
  }

  if (cancelUploadBtn) {
    cancelUploadBtn.addEventListener('click', () => {
      uploadZone.style.display = 'none';
      selectedFiles = [];
    });
  }

  if (confirmUploadBtn) {
    confirmUploadBtn.addEventListener('click', async () => {
      if (selectedFiles.length === 0) {
        alert('请选择文件');
        return;
      }

      const formData = new FormData();
      selectedFiles.forEach(f => formData.append('files', f));
      formData.append('category', uploadCategory.value);

      try {
        confirmUploadBtn.disabled = true;
        confirmUploadBtn.textContent = '上传中...';

        await fetch('/api/knowledge/upload', {
          method: 'POST',
          body: formData
        });

        await loadKnowledgeTree();
        uploadZone.style.display = 'none';
        selectedFiles = [];
        alert('上传成功');
      } catch (err) {
        alert('上传失败: ' + err.message);
      } finally {
        confirmUploadBtn.disabled = false;
        confirmUploadBtn.textContent = '上传';
      }
    });
  }

  // 搜索
  if (kbSearchInput) {
    let searchTimeout;
    kbSearchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => searchKnowledge(e.target.value), 300);
    });
  }

  // 树形目录点击
  document.querySelectorAll('.tree-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.tree-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      loadKnowledgeTree();
    });
  });

  // 加载知识库
  loadKnowledgeTree();
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

async function loadKnowledgeTree() {
  try {
    const res = await fetch('/api/knowledge/tree');
    const tree = await res.json();
    renderKnowledgeTree(tree);
    renderKnowledgeListFromTree(tree);
  } catch (err) {
    console.error('加载知识库失败:', err);
  }
}

function renderKnowledgeTree(tree) {
  const treeEl = document.getElementById('knowledgeTree');
  if (!treeEl) return;

  treeEl.innerHTML = `
    <div class="tree-item active" data-id="root">
      <span class="tree-icon">📁</span>
      <span class="tree-name">全部知识</span>
    </div>
  `;

  tree.forEach(item => {
    if (item.type === 'directory') {
      const dirEl = document.createElement('div');
      dirEl.className = 'tree-item';
      dirEl.dataset.id = item.path;
      dirEl.innerHTML = `
        <span class="tree-icon">📂</span>
        <span class="tree-name">${item.name}</span>
      `;
      dirEl.addEventListener('click', () => {
        document.querySelectorAll('.tree-item').forEach(i => i.classList.remove('active'));
        dirEl.classList.add('active');
        renderKnowledgeListFromTree(tree, item.path);
      });
      treeEl.appendChild(dirEl);
    }
  });

  // 重新绑定点击事件
  treeEl.querySelectorAll('.tree-item').forEach(item => {
    item.addEventListener('click', () => {
      treeEl.querySelectorAll('.tree-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      const path = item.dataset.id;
      renderKnowledgeListFromTree(tree, path === 'root' ? '' : path);
    });
  });
}

function renderKnowledgeListFromTree(tree, filterPath = '') {
  const knowledgeList = document.getElementById('knowledgeList');
  if (!knowledgeList) return;

  const articles = [];

  function collectArticles(items, currentPath) {
    items.forEach(item => {
      if (item.type === 'file') {
        if (!filterPath || item.path.startsWith(filterPath)) {
          articles.push(item);
        }
      } else if (item.type === 'directory' && item.children) {
        collectArticles(item.children, currentPath ? `${currentPath}/${item.name}` : item.name);
      }
    });
  }

  collectArticles(tree, '');

  if (articles.length === 0) {
    knowledgeList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📚</div>
        <p>暂无知识库文档</p>
        <p class="empty-hint">点击「新建文档」开始创建</p>
      </div>
    `;
    return;
  }

  knowledgeList.innerHTML = articles.map(a => `
    <div class="kb-article" data-path="${a.path}">
      <div class="kb-article-title">${a.name}</div>
      <div class="kb-article-meta">更新于 ${formatTime(a.updatedAt)}</div>
      <div class="kb-article-preview">${(a.preview || '').substring(0, 100)}</div>
    </div>
  `).join('');

  // 点击文章可编辑
  knowledgeList.querySelectorAll('.kb-article').forEach(el => {
    el.addEventListener('click', async () => {
      const filePath = el.dataset.path;
      try {
        const res = await fetch(`/api/knowledge/article?path=${encodeURIComponent(filePath)}`);
        const data = await res.json();
        document.getElementById('knowledgeList').style.display = 'none';
        const editor = document.getElementById('knowledgeEditor');
        editor.style.display = 'flex';
        document.getElementById('editorTitle').value = data.path.split('/').pop().replace('.md', '');
        document.getElementById('editorContent').value = data.content;
      } catch (err) {
        console.error('加载文章失败:', err);
      }
    });
  });
}

async function searchKnowledge(query) {
  if (!query.trim()) {
    await loadKnowledgeTree();
    return;
  }

  try {
    const res = await fetch(`/api/knowledge/search?q=${encodeURIComponent(query)}`);
    const results = await res.json();
    renderSearchResults(results);
  } catch (err) {
    console.error('搜索失败:', err);
  }
}

function renderSearchResults(results) {
  const knowledgeList = document.getElementById('knowledgeList');
  if (!knowledgeList) return;

  if (results.length === 0) {
    knowledgeList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <p>未找到相关文档</p>
      </div>
    `;
    return;
  }

  knowledgeList.innerHTML = results.map(r => `
    <div class="kb-article" data-path="${r.path}">
      <div class="kb-article-title">${r.title}</div>
      <div class="kb-article-preview">${r.preview}</div>
    </div>
  `).join('');

  knowledgeList.querySelectorAll('.kb-article').forEach(el => {
    el.addEventListener('click', async () => {
      const filePath = el.dataset.path;
      try {
        const res = await fetch(`/api/knowledge/article?path=${encodeURIComponent(filePath)}`);
        const data = await res.json();
        document.getElementById('knowledgeList').style.display = 'none';
        const editor = document.getElementById('knowledgeEditor');
        editor.style.display = 'flex';
        document.getElementById('editorTitle').value = data.path.split('/').pop().replace('.md', '');
        document.getElementById('editorContent').value = data.content;
      } catch (err) {
        console.error('加载文章失败:', err);
      }
    });
  });
}

function formatTime(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diff = now - date;
  if (diff < 86400000) return '今天';
  if (diff < 172800000) return '昨天';
  if (diff < 604800000) return Math.floor(diff / 86400000) + ' 天前';
  return date.toLocaleDateString();
}

// 启动
init();
