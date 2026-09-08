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
  const [activeId, setActiveId] = useState(initialActiveConversationId);
  const [states, setStates] = useState(() => initialActiveConversationId ? { [initialActiveConversationId]: emptyState(initialMessages, initialExecutionStatus, initialActiveJobId) } : {});
  const [input, setInput] = useState('');
  const [connection, setConnection] = useState(initialConnection);
  const [protocol, setProtocol] = useState(null);
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
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

  useEffect(() => {
    if (initialConversations.length) return;
    request('/api/conversations').then(({ conversations: items = [] }) => {
      setConversations(items);
      if (!activeRef.current && items[0]) { activeRef.current = items[0].id; setActiveId(items[0].id); }
    }).catch((error) => setNotice(error.message));
  }, []);

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

  function send(event) {
    event.preventDefault();
    const text = input.trim();
    const socket = socketRef.current;
    if (!text || !activeId || socket?.readyState !== WebSocket.OPEN) return;
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

  async function saveSolution(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      await request('/api/solutions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: form.get('title'), description: form.get('description'), solution: current.messages.filter((item) => item.role === 'assistant').map((item) => item.text).join('\n\n'), chatHistory: current.messages }) });
      setNotice('已保存到你的私有方案库。');
    } catch (error) { setNotice(error.message); } finally { setSaving(false); }
  }

  return <section className="conversation-workspace">
    <ConversationList conversations={conversations} activeId={activeId} busy={creating} onCreate={createConversation} onSelect={(id) => { activeRef.current = id; setActiveId(id); setNotice(''); }} />
    <div className="panel chat">
      <ExecutionStatus connection={connection} executionStatus={current.status} activeJobId={current.activeJobId} onCancel={cancel} />
      {(current.recoveryBoundary || current.status === 'interrupted') && <p className="recovery-banner">任务不会自动重放，请确认上下文后重新发送。</p>}
      <div className="message-list">{current.messages.length ? current.messages.map((message) => <p className={message.role} key={message.id || `${message.role}:${message.text}`}>{message.text}</p>) : <div className="empty"><b>{activeId ? '与 OpenCode 开始一次对话' : '先新建一个私人对话'}</b><span>模型、Agent、Skill 与工具执行统一经过服务端安全边界</span></div>}</div>
      <form onSubmit={send}><textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="输入你的问题…" aria-label="对话内容" disabled={!activeId} /><button disabled={!activeId || connection !== 'connected'}>发送</button></form>
      <p className="chat-notice" role="status">{notice}</p>
    </div>
    {current.messages.length > 0 && <aside className="panel solution-capture"><p className="eyebrow">人工确认后沉淀</p><h3>沉淀为方案</h3><p className="muted">对话不会自动公开，保存后默认仅本人可见。</p><form className="stack" onSubmit={saveSolution}><input name="title" placeholder="方案标题" required /><textarea name="description" placeholder="补充问题背景或约束" /><button disabled={saving}>{saving ? '保存中…' : '保存私有方案'}</button></form></aside>}
  </section>;
}
