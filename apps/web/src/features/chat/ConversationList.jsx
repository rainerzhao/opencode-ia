import React from 'react';

export function ConversationList({ conversations, activeId, busy, onCreate, onSelect }) {
  return <aside className="conversation-rail" aria-label="私人对话">
    <div className="conversation-rail__head">
      <div><p className="eyebrow">Private workspace</p><h3>我的对话</h3></div>
      <button type="button" onClick={onCreate} disabled={busy}>新建对话</button>
    </div>
    <div className="conversation-list">
      {conversations.length === 0
        ? <p className="conversation-list__empty">还没有对话。新建后，每段上下文都会独立保存。</p>
        : conversations.map((conversation) => <button
            type="button" key={conversation.id}
            className={conversation.id === activeId ? 'conversation-item active' : 'conversation-item'}
            aria-current={conversation.id === activeId ? 'page' : undefined}
            onClick={() => onSelect(conversation.id)}
          ><span>{conversation.title}</span><small>{conversation.id === activeId ? '当前对话' : '默认私有'}</small></button>)}
    </div>
  </aside>;
}
