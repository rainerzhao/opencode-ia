import React, { useEffect, useMemo, useState } from 'react';
import { request } from '../../api/client';

const activeRequirementStatuses = new Set(['draft', 'clarifying', 'in_progress']);
const statusPriority = { clarifying: 0, in_progress: 1, draft: 2 };
const statusNames = { draft: '待梳理', clarifying: '待澄清', in_progress: '推进中', resolved: '已解决', archived: '已归档' };

function timestamp(item) {
  const value = new Date(item?.updatedAt || item?.createdAt || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

function newestFirst(left, right) {
  return timestamp(right) - timestamp(left);
}

function requirementPriority(left, right) {
  const priority = (statusPriority[left.status] ?? 9) - (statusPriority[right.status] ?? 9);
  return priority || newestFirst(left, right);
}

function updatedWithin(item, start, end) {
  const value = timestamp(item);
  return value >= start && value <= end;
}

export function buildWorkbenchView({ requirements = [], conversations = [], knowledge = [], solutions = [] } = {}, now = new Date()) {
  const nowValue = new Date(now).getTime();
  const weekStart = nowValue - (7 * 24 * 60 * 60 * 1000);
  const activeRequirements = requirements.filter((item) => activeRequirementStatuses.has(item.status)).sort(requirementPriority);
  const clarifyingRequirements = activeRequirements.filter((item) => item.status === 'clarifying').sort(newestFirst);
  const clarificationRows = clarifyingRequirements.slice(0, 4);
  const activeConversations = conversations.filter((item) => !['archived', 'closed'].includes(item.status)).sort(newestFirst);
  const assets = [...knowledge.map((item) => ({ ...item, assetType: '知识' })), ...solutions.map((item) => ({ ...item, assetType: '方案' }))];
  const privateDraftAssets = assets.filter((item) => item.visibility !== 'team' && item.status !== 'published');
  const reusableAssets = assets.filter((item) => item.visibility === 'team' || item.status === 'published');
  const recentItems = [...requirements, ...conversations, ...assets].filter((item) => updatedWithin(item, weekStart, nowValue));
  const nextRequirement = clarificationRows[0] || activeRequirements[0] || null;
  const milestones = [
    ...requirements.map((item) => ({ ...item, kind: '需求' })),
    ...conversations.map((item) => ({ ...item, kind: '会话' })),
    ...assets.map((item) => ({ ...item, kind: item.assetType }))
  ].filter((item) => item.title).sort(newestFirst).slice(0, 4);

  return {
    activeRequirements: activeRequirements.length,
    clarifyingRequirements: clarifyingRequirements.length,
    activeConversations: activeConversations.length,
    privateDraftAssets: privateDraftAssets.length,
    reusableAssets: reusableAssets.length,
    updatedThisWeek: recentItems.length,
    nextAction: nextRequirement || activeConversations[0] || null,
    nextDestination: nextRequirement ? 'requirements' : activeConversations[0] ? 'chat' : 'requirements',
    requirementRows: activeRequirements.slice(0, 5),
    clarificationRows,
    conversationRows: activeConversations.slice(0, 3),
    milestones,
    assetLifecycle: { privateDrafts: privateDraftAssets.length, reusable: reusableAssets.length, total: assets.length }
  };
}

export function deriveWorkbenchSnapshot(data = {}) {
  const view = buildWorkbenchView(data);
  return {
    activeRequirements: view.activeRequirements,
    clarifyingRequirements: view.clarifyingRequirements,
    activeConversations: view.activeConversations,
    privateDraftAssets: view.privateDraftAssets
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

function Metric({ label, value, note, tone = '', icon }) {
  return <article className={`home-signal ${tone}`.trim()}><div className="home-signal__top"><span className="home-signal__icon" aria-hidden="true">{icon}</span><strong>{value}</strong></div><div><span>{label}</span><small>{note}</small></div></article>;
}

function formatDate(value, options = { month: 'numeric', day: 'numeric' }) {
  if (!value || !timestamp({ updatedAt: value })) return '暂无时间';
  return new Intl.DateTimeFormat('zh-CN', options).format(new Date(value));
}

function greetingFor(date) {
  const hour = new Date(date).getHours();
  if (hour < 11) return '上午好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function statusLabel(status) {
  return statusNames[status] || '进行中';
}

function EmptyRow({ children }) {
  return <div className="home-empty"><strong>暂时没有待处理内容</strong><span>{children}</span></div>;
}

export function HomePage({ go, user = {}, initialData = null, fetcher = request, now = new Date() }) {
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

  const view = useMemo(() => buildWorkbenchView(data || {}, now), [data, now]);
  const loading = state === 'loading';
  const value = (number) => loading ? '—' : number;
  const displayName = user.displayName || user.username || '同事';
  const nextAction = view.nextAction;
  const nextTitle = loading ? '正在整理你的工作队列' : nextAction?.title || '记录第一条 BU 需求';
  const today = new Date(now);

  return <section className="home-workbench home-command">
    <header className="home-command__brief">
      <div><p className="wb-eyebrow">PERSONAL COMMAND CENTER</p><h2>{greetingFor(today)}，{displayName}</h2><p>{state === 'error' ? '实时概览暂时不可用，工作区入口仍可正常使用。' : '从今天最重要的一步开始，把零散沟通推进成可复用的云方案。'}</p></div>
      <div className="home-command__date"><strong>{formatDate(today, { year: 'numeric', month: 'long', day: 'numeric' })}</strong><span>{new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(today)}</span></div>
      <blockquote>把复杂的需求，变成可执行的方案。</blockquote>
    </header>

    <section className="home-next wb-panel" aria-label="下一步要做">
      <div className="home-next__accent" />
      <div className="home-next__body"><p className="wb-eyebrow">下一步要做</p><h1>{nextTitle}</h1><div className="home-next__facts"><span>{nextAction?.buName || '个人任务队列'}</span><span>{nextAction?.status ? statusLabel(nextAction.status) : '默认私有'}</span><span>{nextAction?.updatedAt ? `更新于 ${formatDate(nextAction.updatedAt)}` : '等待首次记录'}</span></div></div>
      <aside className="home-next__reminders" aria-label="相关提醒"><strong>相关提醒</strong><span className={view.clarifyingRequirements ? 'attention' : ''}>{view.clarifyingRequirements ? `${view.clarifyingRequirements} 条事实等待澄清` : '暂无待澄清事项'}</span><span>{view.privateDraftAssets ? `${view.privateDraftAssets} 份私有资产待整理` : '私有资产已处理'}</span></aside>
      <button type="button" onClick={() => go(view.nextDestination)}>{nextAction ? '继续处理' : '快速记录'} <span aria-hidden="true">→</span></button>
    </section>

    <div className="home-signal-grid" aria-label="工作状态概览" aria-live="polite">
      <Metric label="待推进需求" value={value(view.activeRequirements)} note="事实、约束与下一步" tone="home-signal--active" icon="↗" />
      <Metric label="进行中会话" value={value(view.activeConversations)} note="持续保存私有上下文" icon="◎" />
      <Metric label="本周有更新" value={value(view.updatedThisWeek)} note="需求、会话与资产" icon="▤" />
      <Metric label="待澄清问题" value={value(view.clarifyingRequirements)} note="先补事实再生成方案" tone="home-signal--attention" icon="?" />
      <Metric label="团队可复用" value={value(view.reusableAssets)} note="已发布知识与方案" icon="◇" />
    </div>

    <div className="home-operations">
      <section className="home-queue wb-panel">
        <div className="home-section-head"><div><p className="wb-eyebrow">需求推进</p><h3>待推进需求 <span>({value(view.activeRequirements)})</span></h3></div><button className="ghost" type="button" onClick={() => go('requirements')}>查看全部 →</button></div>
        <div className="home-table" aria-label="待推进需求列表">
          <div className="home-table__head"><span>优先</span><span>需求名称</span><span>客户 / BU</span><span>当前阶段</span><span>最近更新</span></div>
          {view.requirementRows.length ? view.requirementRows.map((item, index) => <button className="home-table__row" type="button" onClick={() => go('requirements')} key={item.id || `${item.title}-${index}`}>
            <span><i className={`home-priority home-priority--${item.status}`}>{item.status === 'clarifying' ? '高' : item.status === 'in_progress' ? '中' : '常'}</i></span>
            <strong>{item.title || '未命名需求'}</strong><span>{item.buName || '未归属 BU'}</span><span><i className={`home-stage home-stage--${item.status}`} />{statusLabel(item.status)}</span><time>{formatDate(item.updatedAt)}</time>
          </button>) : <EmptyRow>从一次 IM 工具、电话或会议沟通开始记录。</EmptyRow>}
        </div>
      </section>

      <section className="home-clarify wb-panel">
        <div className="home-section-head"><div><p className="wb-eyebrow">事实队列</p><h3>待澄清 <span>({value(view.clarifyingRequirements)})</span></h3></div><button className="ghost" type="button" onClick={() => go('requirements')}>查看全部 →</button></div>
        <div className="home-compact-list">{view.clarificationRows.length ? view.clarificationRows.map((item) => <button type="button" onClick={() => go('requirements')} key={item.id}><i /><span><strong>{item.title}</strong><small>{item.buName || '未归属 BU'} · {formatDate(item.updatedAt)}</small></span></button>) : <EmptyRow>当前没有等待澄清的需求。</EmptyRow>}</div>
      </section>

      <section className="home-assets wb-panel">
        <div className="home-section-head"><div><p className="wb-eyebrow">资产沉淀</p><h3>复用生命周期</h3></div><button className="ghost" type="button" onClick={() => go('solutions')}>资产库 →</button></div>
        <div className="home-lifecycle"><div><span>沟通事实</span><i className="complete" /></div><div><span>私有草稿</span><i className={view.assetLifecycle.privateDrafts ? 'current' : 'complete'} /></div><div><span>人工确认</span><i className={view.assetLifecycle.reusable ? 'complete' : ''} /></div><div><span>团队复用</span><i className={view.assetLifecycle.reusable ? 'current' : ''} /></div></div>
        <dl><div><dt>私有草稿</dt><dd>{value(view.assetLifecycle.privateDrafts)}</dd></div><div><dt>可复用</dt><dd>{value(view.assetLifecycle.reusable)}</dd></div><div><dt>全部资产</dt><dd>{value(view.assetLifecycle.total)}</dd></div></dl>
        <p>只有本人明确发布后，内容才会进入团队资产。</p>
      </section>

      <section className="home-collaboration wb-panel">
        <div className="home-section-head"><div><p className="wb-eyebrow">持续上下文</p><h3>进行中协作 <span>({value(view.activeConversations)})</span></h3></div><span className="wb-status wb-status--active">OpenCode Runtime</span></div>
        <div className="home-conversation-list">{view.conversationRows.length ? view.conversationRows.map((item, index) => <button type="button" onClick={() => go('chat')} key={item.id || `${item.title}-${index}`}><span className="home-avatar">OC</span><span><strong>{item.title || '未命名会话'}</strong><small>私有上下文 · {formatDate(item.updatedAt)}</small></span><i>继续 →</i></button>) : <EmptyRow>建立会话后，OpenCode 会按会话恢复对应上下文。</EmptyRow>}</div>
        <button className="ghost home-collaboration__action" type="button" onClick={() => go('chat')}>继续 AI 对话</button>
      </section>

      <section className="home-milestones wb-panel">
        <div className="home-section-head"><div><p className="wb-eyebrow">变化记录</p><h3>近期里程碑</h3></div></div>
        <ol>{view.milestones.length ? view.milestones.map((item, index) => <li key={`${item.kind}-${item.id || index}`}><time>{formatDate(item.updatedAt || item.createdAt)}</time><i /><span><strong>{item.kind} · {item.title}</strong><small>{item.status ? statusLabel(item.status) : item.visibility === 'team' ? '团队可见' : '默认私有'}</small></span></li>) : <li className="home-milestones__empty"><span>完成第一次记录后，关键变化会出现在这里。</span></li>}</ol>
      </section>
    </div>
  </section>;
}
