import React, { useEffect, useRef, useState } from 'react';
import { request } from '../../api/client';
import { ConversationList } from './ConversationList';
import { ExecutionStatus } from './ExecutionStatus';

const emptyState = (messages = [], status = 'idle', activeJobId = null) => ({ messages, status, cursor: 0, activeJobId, recoveryBoundary: false });

function upsert(messages, message, append = false) {
  const index = messages.findIndex((item) => item.id === message.id);
  if (index < 0) return [...messages, message];
  const next = [...messages];
  next[index] = append ? { ...next[index], text: next[index].text + message.text } : message;
  return next;
}

export function applyGatewayEvent(state, event) {
  if (event.sequence > 0 && event.sequence <= state.cursor) return state;
  let next = { ...state, cursor: Math.max(state.cursor, event.sequence || 0) };
  if (event.type === 'conversation.snapshot') return { ...next, recoveryBoundary: event.data?.recoveryBoundary === true };
  if (event.type === 'conversation.recovery_boundary') return { ...next, recoveryBoundary: true };
  if (event.type === 'message.created') next.messages = upsert(next.messages, { id: `${event.jobId}:user`, role: 'user', text: event.data?.text || '' });
  if (event.type === 'message.delta') next.messages = upsert(next.messages, { id: `${event.jobId}:assistant`, role: 'assistant', text: event.data?.text || '' }, true);
  if (event.type === 'job.queued') next = { ...next, status: 'queued', activeJobId: event.jobId };
  if (event.type === 'job.started') next = { ...next, status: 'running', activeJobId: event.jobId };
  if (event.type === 'job.completed') next = { ...next, status: 'completed', activeJobId: null };
  if (event.type === 'job.cancelled') next = { ...next, status: 'cancelled', activeJobId: null };
  if (event.type === 'job.interrupted') next = { ...next, status: 'interrupted', activeJobId: null };
  if (event.type === 'job.failed') next = { ...next, status: event.data?.status || 'failed', activeJobId: null };
  return next;
}

export function ChatPage({ initialMessages = [], initialConversations = [], initialActiveConversationId = initialConversations[0]?.id || null, initialExecutionStatus = 'idle', initialActiveJobId = null, initialConnection = 'reconnecting' }) {
  const [conversations, setConversations] = useState(initialConversations);
  const [conversationStatus, setConversationStatus] = useState(() => initialConversations.find((item) => item.id === initialActiveConversationId)?.status || 'active');
  const [conversationQuery, setConversationQuery] = useState('');
  const [hasMoreConversations, setHasMoreConversations] = useState(false);
  const [conversationOffset, setConversationOffset] = useState(0);
  const [activeId, setActiveId] = useState(initialActiveConversationId);
  const [states, setStates] = useState(() => initialActiveConversationId ? { [initialActiveConversationId]: emptyState(initialMessages, initialExecutionStatus, initialActiveJobId) } : {});
  const [input, setInput] = useState('');
  const [connection, setConnection] = useState(initialConnection);
  const [protocol, setProtocol] = useState(null);
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draftNotice, setDraftNotice] = useState('');
  const socketRef = useRef();
  const activeRef = useRef(activeId);
  const statesRef = useRef(states);

  useEffect(() => { activeRef.current = activeId; }, [activeId]);
  useEffect(() => { statesRef.current = states; }, [states]);

  function update(conversationId, reducer) {
    setStates((current) => {
      const next = { ...current, [conversationId]: reducer(current[conversationId] || emptyState()) };
      statesRef.current = next;
      return next;
    });
  }

  useEffect(() => {
    let closedByPage = false;
    let timer;
    let retry = 0;
    function connect() {
      const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${wsProtocol}//${location.host}`);
      socketRef.current = socket;
      setConnection('reconnecting');
      socket.onmessage = (raw) => {
        let message;
        try { message = JSON.parse(raw.data); } catch { return; }
        if (message.type === 'connected') {
          const selected = message.protocol || 'legacy.v1';
          setProtocol(selected);
          setConnection('connected');
          retry = 0;
          if (selected === 'gateway.v1' && activeRef.current) socket.send(JSON.stringify({ type: 'subscribe', conversationId: activeRef.current, afterSequence: statesRef.current[activeRef.current]?.cursor || 0 }));
          return;
        }
        if (message.conversationId && message.sequence !== undefined) {
          update(message.conversationId, (state) => applyGatewayEvent(state, message));
          if (message.type === 'conversation.snapshot' && message.data?.recoveryBoundary) setNotice('连接已恢复到最新一致状态，较早的流式片段未重复加载。');
          return;
        }
        if ((message.type === 'response' || message.type === 'error') && activeRef.current) update(activeRef.current, (state) => ({ ...state, status: message.type === 'error' ? 'failed' : 'completed', activeJobId: null, messages: [...state.messages, { id: `legacy:${Date.now()}`, role: 'assistant', text: message.data || message.message }] }));
      };
      socket.onclose = (event) => {
        if (event.code === 1008) {
          setConnection('disconnected');
          window.dispatchEvent(new CustomEvent('workbench:auth-expired'));
        } else if (!closedByPage) {
          setConnection('reconnecting');
          timer = setTimeout(connect, Math.min(1000 * (2 ** retry++), 8000));
        }
      };
      socket.onerror = () => setConnection('reconnecting');
    }
    connect();
    return () => { closedByPage = true; clearTimeout(timer); socketRef.current?.close(); };
  }, []);

  async function loadConversations({ status = conversationStatus, query = conversationQuery, offset = 0, append = false } = {}) {
    try {
      const params = new URLSearchParams({ status, limit: '20', offset: String(offset) }); if (query) params.set('q', query);
      const result = await request(`/api/conversations?${params}`); const items = result.conversations || [];
      setConversations((current) => append ? [...current, ...items] : items); setHasMoreConversations(result.hasMore === true); setConversationOffset(offset + items.length);
      if (status === 'active' && !append && !activeRef.current && items[0]) { activeRef.current = items[0].id; setActiveId(items[0].id); }
    } catch (error) { setNotice(error.message); }
  }
  useEffect(() => { if (!initialConversations.length) loadConversations(); }, []);

  useEffect(() => {
    if (protocol !== 'gateway.v1' || !activeId || socketRef.current?.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(JSON.stringify({ type: 'subscribe', conversationId: activeId, afterSequence: statesRef.current[activeId]?.cursor || 0 }));
  }, [activeId, protocol]);

  async function createConversation() {
    setCreating(true);
    try {
      const { conversation } = await request('/api/conversations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: `新对话 ${new Date().toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` }) });
      setConversations((current) => [conversation, ...current]);
      setStates((current) => ({ ...current, [conversation.id]: emptyState() }));
      activeRef.current = conversation.id;
      setActiveId(conversation.id);
      setNotice('');
    } catch (error) { setNotice(error.message); } finally { setCreating(false); }
  }

  function changeConversationLibrary(status, query = conversationQuery) {
    setConversationStatus(status); setConversationQuery(query); setHasMoreConversations(false); setConversationOffset(0); loadConversations({ status, query, offset: 0 });
  }
  async function archiveConversation(id) {
    try { setCreating(true); await request(`/api/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' }); if (id === activeRef.current) { activeRef.current = null; setActiveId(null); } await loadConversations({ status: conversationStatus, query: conversationQuery, offset: 0 }); setNotice('对话已归档；历史保留且不会自动重放任务。'); } catch (error) { setNotice(error.message); } finally { setCreating(false); }
  }
  async function restoreConversation(id) {
    try { setCreating(true); const { conversation } = await request(`/api/conversations/${encodeURIComponent(id)}/restore`, { method: 'POST' }); setConversationStatus('active'); setConversationQuery(''); await loadConversations({ status: 'active', query: '', offset: 0 }); activeRef.current = conversation.id; setActiveId(conversation.id); setNotice('对话已恢复为私有进行中状态。'); } catch (error) { setNotice(error.message); } finally { setCreating(false); }
  }

  function send(event) {
    event.preventDefault();
    const text = input.trim();
    const socket = socketRef.current;
    if (!text || !activeId || selectedIsArchived || socket?.readyState !== WebSocket.OPEN) return;
    if (protocol === 'gateway.v1') socket.send(JSON.stringify({ type: 'prompt', conversationId: activeId, text, idempotencyKey: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}` }));
    else {
      update(activeId, (state) => ({ ...state, status: 'running', messages: [...state.messages, { id: `legacy-user:${Date.now()}`, role: 'user', text }] }));
      socket.send(JSON.stringify({ type: 'input', data: `${text}\n` }));
    }
    setInput('');
  }

  async function cancel() {
    const state = statesRef.current[activeId];
    if (!state?.activeJobId) return;
    if (protocol === 'gateway.v1' && socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ type: 'cancel', conversationId: activeId, jobId: state.activeJobId }));
    else await request(`/api/conversations/${activeId}/jobs/${state.activeJobId}/cancel`, { method: 'POST' });
  }

  const current = states[activeId] || emptyState(initialMessages, initialExecutionStatus);
  const selectedIsArchived = conversations.find((item) => item.id === activeId)?.status === 'archived';

  async function saveSolution(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      await request('/api/content/solutions/from-conversation', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ conversationId: activeId, title: form.get('title'), description: form.get('description') }) });
      setNotice('已保存到你的私有方案库。');
    } catch (error) { setNotice(error.message); } finally { setSaving(false); }
  }

  async function requestRequirementDraft() {
    if (!activeId) return;
    setDrafting(true); setDraftNotice('');
    try {
      const history = await request(`/api/conversations/${encodeURIComponent(activeId)}/events?afterSequence=0&limit=1000`);
      const events = history.events || [];
      if (!events.length) { setDraftNotice('当前对话尚无已保存事件，暂时不能生成草稿。'); return; }
      const result = await request('/api/requirements/drafts', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: globalThis.crypto?.randomUUID?.() || `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          conversationId: activeId, sourceFirstSequence: events[0].sequence, sourceLastSequence: events.at(-1).sequence
        })
      });
      setDraftNotice(`已将本对话事件 ${events[0].sequence}–${events.at(-1).sequence} 交给 OpenCode 生成私有草稿。草稿完成后可在“需求与场景”确认。`);
      if (result.draft?.status === 'failed') setDraftNotice('草稿生成未通过结构校验，未创建任何需求。请补充事实后重试。');
    } catch (error) { setDraftNotice(error.message); } finally { setDrafting(false); }
  }

  return <section className="conversation-workspace">
    <header className="conversation-workspace__header"><div><p className="eyebrow">上下文协作</p><h2>AI 对话工作区</h2><p>每个长期会话保持私有上下文；运行、排队与恢复状态均由 OpenCode Runtime 管理。</p></div><span className="wb-status wb-status--active">OpenCode Runtime</span></header>
    <ConversationList conversations={conversations} activeId={activeId} busy={creating} status={conversationStatus} query={conversationQuery} hasMore={hasMoreConversations} onCreate={createConversation} onQuery={(query) => changeConversationLibrary(conversationStatus, query)} onStatus={(status) => changeConversationLibrary(status)} onLoadMore={() => loadConversations({ offset: conversationOffset, append: true })} onArchive={archiveConversation} onRestore={restoreConversation} onSelect={(id) => { activeRef.current = id; setActiveId(id); setNotice(''); }} />
    <div className="panel chat">
      <ExecutionStatus connection={connection} executionStatus={current.status} activeJobId={current.activeJobId} onCancel={cancel} />
      {(current.recoveryBoundary || current.status === 'interrupted') && <p className="recovery-banner">任务不会自动重放，请确认上下文后重新发送。</p>}
      <div className="message-list">{current.messages.length ? current.messages.map((message) => <p className={message.role} key={message.id || `${message.role}:${message.text}`}>{message.text}</p>) : <div className="empty"><b>{activeId ? '与 OpenCode 开始一次对话' : '先新建一个私人对话'}</b><span>模型、Agent、Skill 与工具执行统一经过服务端安全边界</span></div>}</div>
      <form onSubmit={send}><textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="输入你的问题…" aria-label="对话内容" disabled={!activeId || selectedIsArchived} /><button disabled={!activeId || selectedIsArchived || connection !== 'connected'}>发送</button></form>
      <p className="chat-notice" role="status">{notice}</p>
    </div>
    {current.messages.length > 0 && <aside className="capture-stack"><section className="panel draft-capture"><p className="eyebrow">经 OpenCode Runtime</p><h3>生成需求草稿</h3><p className="muted">仅使用当前对话中明确选择的事件范围（全部已保存事件）；AI 不会自动创建或公开需求。</p><button type="button" onClick={requestRequirementDraft} disabled={drafting || !activeId}>{drafting ? '正在请求…' : '生成需求草稿'}</button><p className="draft-notice" role="status">{draftNotice}</p></section><section className="panel solution-capture"><p className="eyebrow">人工确认后沉淀</p><h3>沉淀为方案</h3><p className="muted">对话不会自动公开，保存后默认仅本人可见。</p><form className="stack" onSubmit={saveSolution}><input name="title" placeholder="方案标题" required /><textarea name="description" placeholder="补充问题背景或约束" /><button disabled={saving}>{saving ? '保存中…' : '保存私有方案'}</button></form></section></aside>}
  </section>;
}
