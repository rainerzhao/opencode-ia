'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.resolve(__dirname, '../..');

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
