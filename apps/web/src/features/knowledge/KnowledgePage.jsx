import React, { useEffect, useMemo, useState } from 'react';
import { request } from '../../api/client';

function flatten(nodes, output = []) {
  for (const node of nodes) {
    if (node.type === 'file') output.push(node);
    if (node.children) flatten(node.children, output);
  }
  return output;
}

export function KnowledgePage({ initialEditor = null }) {
  const [items, setItems] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState(initialEditor);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState({ text: '', error: false });

  async function load() {
    try {
      const tree = await request('/api/knowledge/tree');
      setItems(flatten(tree));
    } catch (error) {
      setNotice({ text: error.message, error: true });
    }
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const normalized = query.trim();
    if (!normalized) {
      setSearchResults([]);
      return undefined;
    }
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const results = await request(`/api/knowledge/search?q=${encodeURIComponent(normalized)}`);
        if (active) setSearchResults(results.map((item) => ({ ...item, name: item.title })));
      } catch (error) {
        if (active) setNotice({ text: error.message, error: true });
      }
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query]);

  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return items;
    return searchResults;
  }, [items, query, searchResults]);

  async function openArticle(item) {
    try {
      const article = await request(`/api/knowledge/article?path=${encodeURIComponent(item.path)}`);
      setEditor({ path: article.path, title: item.name, content: article.content, isNew: false });
    } catch (error) {
      setNotice({ text: error.message, error: true });
    }
  }

  async function saveArticle(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = form.get('title').trim();
    const content = form.get('content');
    try {
      if (editor.isNew) {
        await request('/api/knowledge/article/new', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, content, category: '' })
        });
      } else {
        await request('/api/knowledge/article', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ filePath: editor.path, content })
        });
      }
      setEditor(null);
      setNotice({ text: '文档已保存到你的私有知识区。', error: false });
      await load();
    } catch (error) {
      setNotice({ text: error.message, error: true });
    }
  }

  async function uploadFiles(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    setUploading(true);
    try {
      const body = new FormData();
      files.forEach((file) => body.append('files', file));
      body.append('category', '');
      await request('/api/knowledge/upload', { method: 'POST', body });
      setNotice({ text: `已上传 ${files.length} 个文件到你的私有知识区。`, error: false });
      await load();
    } catch (error) {
      setNotice({ text: error.message, error: true });
    } finally {
      setUploading(false);
    }
  }

  if (editor) return <section className="panel editor-panel">
    <div className="section-head"><div><p className="eyebrow">{editor.isNew ? '新建私有文档' : '编辑私有副本'}</p><h3>{editor.isNew ? '撰写 Markdown 文档' : editor.title}</h3></div><button className="ghost" onClick={() => setEditor(null)}>返回列表</button></div>
    <form className="stack" onSubmit={saveArticle}>
      <label>标题<input name="title" defaultValue={editor.title} readOnly={!editor.isNew} required /></label>
      <label>正文<textarea className="knowledge-content" name="content" defaultValue={editor.content} placeholder="使用 Markdown 编写正文" /></label>
      <div className="form-actions"><span className="muted">保存后默认仅本人可见</span><button>保存文档</button></div>
    </form>
  </section>;

  return <section className="panel">
    <div className="section-head knowledge-head"><div><h3>知识库</h3><p className="muted">共享知识与本人的私有知识合并展示。</p></div><div className="row-actions"><label className="button ghost file-button">{uploading ? '上传中…' : '上传文件'}<input type="file" multiple accept=".md,.txt,.docx,.pdf,.json,.csv" disabled={uploading} onChange={uploadFiles} /></label><button onClick={() => setEditor({ title: '', content: '', isNew: true })}>新建文档</button></div></div>
    <div className="knowledge-toolbar"><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题或正文" aria-label="搜索知识库" /><span className="muted">{visibleItems.length} 篇文档</span></div>
    <p className={notice.error ? 'notice error' : 'notice success'} role="status">{notice.text}</p>
    <div className="list knowledge-list">{visibleItems.length ? visibleItems.map((item) => <button className="knowledge-item" key={item.path} onClick={() => openArticle(item)}><b>{item.name}</b><span>{item.preview || 'Markdown 文档'}</span><small>{item.path}</small></button>) : <div className="empty">{query ? '没有匹配的知识文档' : '暂无知识文档'}</div>}</div>
  </section>;
}
