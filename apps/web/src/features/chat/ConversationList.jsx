import React from 'react';

export function ConversationList({ conversations, activeId, busy, status, query, hasMore, onCreate, onSelect, onQuery, onStatus, onLoadMore, onArchive, onRestore }) {
  return <aside className="conversation-rail" aria-label="私人对话">
    <div className="conversation-rail__head">
      <div><p className="eyebrow">Private workspace</p><h3>我的对话</h3></div>
      <button type="button" onClick={onCreate} disabled={busy}>新建对话</button>
    </div>
    <form className="conversation-library-search" onSubmit={(event) => { event.preventDefault(); onQuery(event.currentTarget.elements.q.value); }}><input name="q" aria-label="搜索我的对话" defaultValue={query} placeholder="搜索我的对话" /><button className="ghost" disabled={busy}>搜索</button></form>
    <div className="conversation-library-filter"><button type="button" className={status === 'active' ? 'active' : ''} onClick={() => onStatus('active')}>进行中</button><button type="button" className={status === 'archived' ? 'active' : ''} onClick={() => onStatus('archived')}>已归档</button></div>
    <div className="conversation-list">
      {conversations.length === 0
        ? <p className="conversation-list__empty">还没有对话。新建后，每段上下文都会独立保存。</p>
        : conversations.map((conversation) => <button
            type="button" key={conversation.id}
            className={conversation.id === activeId ? 'conversation-item active' : 'conversation-item'}
            aria-current={conversation.id === activeId ? 'page' : undefined}
            onClick={() => onSelect(conversation.id)}
          ><span>{conversation.title}</span><small>{status === 'archived' ? '已归档 · 默认私有' : conversation.id === activeId ? '当前对话' : '默认私有'}</small></button>)}
    </div>
    {hasMore && <button className="ghost conversation-load-more" type="button" onClick={onLoadMore} disabled={busy}>加载更多</button>}
    {activeId && <button className="ghost danger conversation-archive" type="button" onClick={() => status === 'archived' ? onRestore(activeId) : onArchive(activeId)} disabled={busy}>{status === 'archived' ? '恢复当前对话' : '归档当前对话'}</button>}
  </aside>;
}
