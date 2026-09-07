'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.resolve(__dirname, '../..');

test('gateway operations shows safe metadata and only active jobs offer cancellation', async () => {
  await withViteModule('features/admin/GatewayPanel.jsx', ({ GatewayPanel }) => {
    const html = renderToStaticMarkup(React.createElement(GatewayPanel, {
      initialData: {
        health: { status: 'healthy', running: 1, queued: 0, healthyWorkers: 2 },
        workers: [{ id: 'worker-1', status: 'healthy', capacity: 1, running: 1, password: 'PRIVATE' }],
        jobs: [{ id: 'job-1', userId: 'member-1', status: 'running', inputText: 'PRIVATE' }, { id: 'job-2', status: 'completed' }]
      }
    }));
    assert.match(html, /运行管理/);
    assert.match(html, /服务正常/);
    assert.match(html, /member-1/);
    assert.equal((html.match(/>取消任务</g) || []).length, 1);
    assert.doesNotMatch(html, /PRIVATE/);
  });
});

async function withViteModule(relativePath, callback) {
  const { createServer } = await import('vite');
  const server = await createServer({
    root: path.join(root, 'apps/web'),
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent'
  });
  try {
    const module = await server.ssrLoadModule(`/src/${relativePath}`);
    await callback(module);
  } finally {
    await server.close();
  }
}

test('administrator can reach every account recovery control', async () => {
  await withViteModule('features/admin/AdminPage.jsx', ({ AdminPage }) => {
    const html = renderToStaticMarkup(React.createElement(AdminPage, {
      user: { id: 'admin-1' },
      initialUsers: [{
        id: 'member-1',
        username: 'member',
        displayName: 'Team Member',
        role: 'member',
        status: 'active'
      }]
    }));

    assert.match(html, /type="password"/);
    assert.match(html, />重置密码</);
    assert.match(html, />撤销会话</);
    assert.match(html, />停用</);
  });
});

test('knowledge page exposes search, authoring, and upload workflows', async () => {
  await withViteModule('features/knowledge/KnowledgePage.jsx', ({ KnowledgePage }) => {
    const html = renderToStaticMarkup(React.createElement(KnowledgePage));
    assert.match(html, /placeholder="搜索标题或正文"/);
    assert.match(html, />新建文档</);
    assert.match(html, />上传文件</);
  });
});

test('editing an existing knowledge article keeps its title in submitted form data', async () => {
  await withViteModule('features/knowledge/KnowledgePage.jsx', ({ KnowledgePage }) => {
    const html = renderToStaticMarkup(React.createElement(KnowledgePage, {
      initialEditor: { path: 'notes/example.md', title: 'example', content: '# example', isNew: false }
    }));
    const titleInput = html.match(/<input[^>]*name="title"[^>]*>/)?.[0];
    assert.ok(titleInput, 'title input should remain part of the edit form');
    assert.match(titleInput, /readOnly=""/);
    assert.doesNotMatch(titleInput, /disabled/);
  });
});

test('a conversation can be explicitly saved as a private solution', async () => {
  await withViteModule('features/chat/ChatPage.jsx', ({ ChatPage }) => {
    const html = renderToStaticMarkup(React.createElement(ChatPage, {
      initialMessages: [{ role: 'assistant', text: 'A reviewed answer' }]
    }));
    assert.match(html, />沉淀为方案</);
    assert.match(html, /默认仅本人可见/);
  });
});

test('chat page exposes private conversation navigation and running controls', async () => {
  await withViteModule('features/chat/ChatPage.jsx', ({ ChatPage }) => {
    const html = renderToStaticMarkup(React.createElement(ChatPage, {
      initialConversations: [
        { id: 'conversation-1', title: '季度预算分析', status: 'active' },
        { id: 'conversation-2', title: '客户方案复盘', status: 'active' }
      ],
      initialActiveConversationId: 'conversation-1',
      initialExecutionStatus: 'running',
      initialActiveJobId: 'job-1',
      initialConnection: 'connected'
    }));

    assert.match(html, />新建对话</);
    assert.match(html, />季度预算分析</);
    assert.match(html, />客户方案复盘</);
    assert.match(html, />正在运行</);
    assert.match(html, />停止任务</);
  });
});

test('chat event reducer rebuilds private message history and execution state', async () => {
  await withViteModule('features/chat/ChatPage.jsx', ({ applyGatewayEvent }) => {
    let state = { messages: [], status: 'idle', cursor: 0, activeJobId: null, recoveryBoundary: false };
    state = applyGatewayEvent(state, {
      type: 'message.created', jobId: 'job-1', sequence: 1,
      data: { role: 'user', text: '请分析预算' }
    });
    state = applyGatewayEvent(state, {
      type: 'job.started', jobId: 'job-1', sequence: 3, data: { status: 'running' }
    });
    state = applyGatewayEvent(state, {
      type: 'message.delta', jobId: 'job-1', sequence: 4, data: { text: '结论一' }
    });
    state = applyGatewayEvent(state, {
      type: 'message.delta', jobId: 'job-1', sequence: 5, data: { text: '；结论二' }
    });
    state = applyGatewayEvent(state, {
      type: 'job.completed', jobId: 'job-1', sequence: 6, data: { status: 'completed' }
    });

    assert.deepEqual(state.messages, [
      { id: 'job-1:user', role: 'user', text: '请分析预算' },
      { id: 'job-1:assistant', role: 'assistant', text: '结论一；结论二' }
    ]);
    assert.equal(state.status, 'completed');
    assert.equal(state.cursor, 6);
    assert.equal(state.activeJobId, null);
    state = applyGatewayEvent(state, {
      type: 'conversation.recovery_boundary', sequence: 7, data: {}
    });
    assert.equal(state.recoveryBoundary, true);
    assert.equal(state.messages.length, 2);
  });
});
