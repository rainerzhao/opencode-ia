import React, { useEffect, useRef, useState } from 'react';
import { request } from '../../api/client';

export function ChatPage({ initialMessages = [] }) {
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState('正在连接 OpenCode…');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const socketRef = useRef();

  useEffect(() => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${location.host}`);
    socketRef.current = socket;
    socket.onopen = () => setStatus('OpenCode 已连接');
    socket.onmessage = (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'response' || message.type === 'error') {
        setMessages((current) => [...current, { role: 'assistant', text: message.data || message.message }]);
      }
    };
    socket.onclose = (event) => {
      setStatus(event.code === 1008 ? '登录已失效，请重新登录' : 'OpenCode 连接已断开');
      if (event.code === 1008) window.dispatchEvent(new CustomEvent('workbench:auth-expired'));
    };
    socket.onerror = () => setStatus('OpenCode 暂时不可用');
    return () => socket.close();
  }, []);

  function send(event) {
    event.preventDefault();
    const text = input.trim();
    if (!text || socketRef.current?.readyState !== WebSocket.OPEN) return;
    setMessages((current) => [...current, { role: 'user', text }]);
    socketRef.current.send(JSON.stringify({ type: 'input', data: `${text}\n` }));
    setInput('');
  }

  async function saveSolution(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      await request('/api/solutions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: form.get('title'),
          description: form.get('description'),
          solution: messages.filter((message) => message.role === 'assistant').map((message) => message.text).join('\n\n'),
          chatHistory: messages
        })
      });
      setNotice('已保存到你的私有方案库。');
    } catch (error) {
      setNotice(error.message);
    } finally {
      setSaving(false);
    }
  }

  return <section className="chat-layout">
    <div className="panel chat">
      <div className="chat-status"><span className="status-dot" />{status}</div>
      <div className="message-list">{messages.length ? messages.map((message, index) => <p className={message.role} key={index}>{message.text}</p>) : <div className="empty"><b>与 OpenCode 开始一次对话</b><span>模型、Agent、Skill 与工具执行统一经过服务端安全边界</span></div>}</div>
      <form onSubmit={send}><textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="输入你的问题…" aria-label="对话内容" /><button>发送</button></form>
    </div>
    {messages.length > 0 && <aside className="panel solution-capture"><p className="eyebrow">人工确认后沉淀</p><h3>沉淀为方案</h3><p className="muted">对话不会自动公开，保存后默认仅本人可见。</p><form className="stack" onSubmit={saveSolution}><input name="title" placeholder="方案标题" required /><textarea name="description" placeholder="补充问题背景或约束" /><button disabled={saving}>{saving ? '保存中…' : '保存私有方案'}</button></form><p className="notice success" role="status">{notice}</p></aside>}
  </section>;
}
