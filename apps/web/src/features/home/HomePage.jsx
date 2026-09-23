import React, { useEffect, useMemo, useState } from 'react';
import { request } from '../../api/client';

const activeRequirementStatuses = new Set(['draft', 'clarifying', 'in_progress']);

export function deriveWorkbenchSnapshot({ requirements = [], conversations = [], knowledge = [], solutions = [] } = {}) {
  const activeRequirements = requirements.filter((item) => activeRequirementStatuses.has(item.status));
  const privateDraftAssets = [...knowledge, ...solutions].filter((item) => item.visibility !== 'team' && item.status !== 'published');
  return {
    activeRequirements: activeRequirements.length,
    clarifyingRequirements: activeRequirements.filter((item) => item.status === 'clarifying').length,
    activeConversations: conversations.length,
    privateDraftAssets: privateDraftAssets.length
  };
}

function normalizeWorkbenchData([requirements, conversations, knowledge, solutions]) {
  return {
    requirements: requirements?.items || [],
    conversations: conversations?.conversations || [],
    knowledge: knowledge?.knowledge || [],
    solutions: solutions?.solutions || []
  };
}

function Metric({ label, value, note, tone = '' }) {
  return <article className={`home-signal ${tone}`.trim()}><div><span>{label}</span><strong>{value}</strong></div><small>{note}</small></article>;
}

export function HomePage({ go, initialData = null, fetcher = request }) {
  const [data, setData] = useState(initialData);
  const [state, setState] = useState(initialData ? 'ready' : 'loading');

  useEffect(() => {
    if (initialData) return undefined;
    let active = true;
    Promise.all([
      fetcher('/api/requirements'),
      fetcher('/api/conversations?status=active&limit=100'),
      fetcher('/api/content/knowledge'),
      fetcher('/api/content/solutions')
    ]).then((results) => {
      if (!active) return;
      setData(normalizeWorkbenchData(results));
      setState('ready');
    }).catch(() => {
      if (active) setState('error');
    });
    return () => { active = false; };
  }, [fetcher, initialData]);

  const snapshot = useMemo(() => deriveWorkbenchSnapshot(data || {}), [data]);
  const loading = state === 'loading';
  const value = (number) => loading ? '—' : number;
  const primaryLabel = snapshot.activeRequirements ? '继续推进需求' : '记录第一条需求';

  return <section className="home-workbench home-command">
    <header className="home-command__brief">
      <div><p className="wb-eyebrow">今日推进</p><h2>把沟通转化为可交付的云方案</h2><p>{state === 'error' ? '实时概览暂时不可用，工作区入口仍可正常使用。' : '这里只汇总你的任务状态和数量，私人标题与正文不会出现在概览中。'}</p></div>
      <span className="wb-status wb-status--active">个人工作区 · 默认私有</span>
    </header>

    <section className="home-next wb-panel" aria-label="下一步要做">
      <div className="home-next__accent" />
      <div className="home-next__body"><p className="wb-eyebrow">下一步要做</p><h1>{primaryLabel}</h1><p>{snapshot.clarifyingRequirements ? `有 ${snapshot.clarifyingRequirements} 项需求等待补充业务事实或确认边界。` : '从 IM 工具、电话或会议事实开始，建立可以持续推进的需求记录。'}</p></div>
      <div className="home-next__meta"><span>需求队列</span><strong>{value(snapshot.activeRequirements)}</strong><small>项待推进</small></div>
      <button type="button" onClick={() => go('requirements')}>{snapshot.activeRequirements ? '继续处理' : '快速记录沟通'} <span aria-hidden="true">→</span></button>
    </section>

    <div className="home-signal-grid" aria-label="工作状态概览" aria-live="polite">
      <Metric label="待推进需求" value={value(snapshot.activeRequirements)} note="事实、约束与下一步" tone="home-signal--active" />
      <Metric label="待澄清" value={value(snapshot.clarifyingRequirements)} note="等待补充沟通" tone="home-signal--attention" />
      <Metric label="进行中协作" value={value(snapshot.activeConversations)} note="长期私有会话" />
      <Metric label="资产沉淀" value={value(snapshot.privateDraftAssets)} note="待确认私有内容" />
    </div>

    <div className="home-operations">
      <section className="home-queue wb-panel">
        <div className="home-section-head"><div><p className="wb-eyebrow">需求推进</p><h3>待推进需求</h3></div><button className="ghost" type="button" onClick={() => go('requirements')}>查看全部 →</button></div>
        <div className="home-queue__row"><span className="wb-status wb-status--attention">高优先级</span><div><strong>补充客户事实与约束</strong><small>进入需求工作区查看私人记录和下一步行动</small></div><b>{value(snapshot.activeRequirements)}</b></div>
        <div className="home-queue__row"><span className="wb-status">待确认</span><div><strong>核对需要澄清的问题</strong><small>保留原始沟通，再更新需求状态</small></div><b>{value(snapshot.clarifyingRequirements)}</b></div>
      </section>

      <section className="home-clarify wb-panel">
        <div className="home-section-head"><div><p className="wb-eyebrow">事实队列</p><h3>待澄清</h3></div></div>
        <p>{snapshot.clarifyingRequirements ? '先补齐事实，再让 OpenCode 帮你提炼方案。' : '当前没有等待澄清的需求。'}</p>
        <button className="ghost" type="button" onClick={() => go('requirements')}>补充沟通</button>
      </section>

      <section className="home-assets wb-panel">
        <div className="home-section-head"><div><p className="wb-eyebrow">资产沉淀</p><h3>从私人草稿到团队复用</h3></div></div>
        <ol><li><span>01</span><div><strong>沟通事实</strong><small>IM 工具、电话、会议与资料</small></div></li><li><span>02</span><div><strong>需求与方案</strong><small>人工确认后形成版本</small></div></li><li><span>03</span><div><strong>团队资产</strong><small>明确发布后才可复用</small></div></li></ol>
        <button className="ghost" type="button" onClick={() => go('solutions')}>查看方案资产</button>
      </section>

      <section className="home-collaboration wb-panel">
        <div className="home-section-head"><div><p className="wb-eyebrow">持续上下文</p><h3>进行中协作</h3></div><span className="wb-status wb-status--active">OpenCode Runtime</span></div>
        <strong>{value(snapshot.activeConversations)} 个私有会话</strong><p>会话、Runtime 和执行槽位分别管理；继续时会恢复对应上下文。</p>
        <button className="ghost" type="button" onClick={() => go('chat')}>继续 AI 对话</button>
      </section>
    </div>
  </section>;
}
