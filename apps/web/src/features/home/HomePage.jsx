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

function MetricCard({ eyebrow, metric, label, description, action, onClick, tone = '' }) {
  return <article className={`workbench-metric ${tone}`.trim()}>
    <p className="eyebrow">{eyebrow}</p>
    <div className="workbench-metric__number" aria-label={`${label} ${metric}`}>{metric}</div>
    <h2>{label}</h2>
    <p>{description}</p>
    <button className="ghost" type="button" onClick={onClick}>{action}</button>
  </article>;
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
  const isLoading = state === 'loading';

  return <section className="home-workbench">
    <div className="home-kicker">
      <div>
        <p className="eyebrow">个人工作台 · 默认私有</p>
        <h1>今天，要把哪一次沟通推进下去？</h1>
        <p>把真实沟通留成需求事实；当方案成熟后，再由你决定是否沉淀为可复用资产。</p>
      </div>
      <button type="button" onClick={() => go('requirements')}>快速记录沟通</button>
    </div>

    <div className="workbench-overview" aria-label="动态概览" aria-live="polite">
      <div>
        <p className="eyebrow">动态概览</p>
        <h2>{isLoading ? '正在整理你的工作节奏…' : state === 'error' ? '暂时无法读取实时概览' : '从事实、沟通到可复用方案'}</h2>
      </div>
      <p>{isLoading ? '仅加载你本人已有资产的状态和数量。' : state === 'error' ? '主导航仍可使用；可直接进入相应工作区刷新数据。' : '仅汇总本人资产的状态与数量，不展示标题或正文。'}</p>
    </div>

    <div className="workbench-metrics">
      <MetricCard eyebrow="需求流" metric={isLoading ? '—' : snapshot.activeRequirements} label="待推进需求" description={isLoading ? '正在读取你的私有需求。' : snapshot.activeRequirements ? '继续补充事实、约束与下一步，让事项保持可追溯。' : '还没有待推进事项，可以从一次真实沟通开始。'} action="打开需求流" onClick={() => go('requirements')} tone="workbench-metric--priority" />
      <MetricCard eyebrow="需要事实确认" metric={isLoading ? '—' : snapshot.clarifyingRequirements} label="待澄清" description="记录 IIM、电话或会议结论，再更新需求状态。" action="补充沟通" onClick={() => go('requirements')} />
      <MetricCard eyebrow="持续上下文" metric={isLoading ? '—' : snapshot.activeConversations} label="进行中会话" description="会话由 OpenCode Gateway 承载；会话数不等于同时推理数。" action="继续 AI 对话" onClick={() => go('chat')} tone="workbench-metric--runtime" />
      <MetricCard eyebrow="私人资产" metric={isLoading ? '—' : snapshot.privateDraftAssets} label="待沉淀内容" description="私有知识和方案仍由你决定是否发布给团队复用。" action="查看方案资产" onClick={() => go('solutions')} />
    </div>

    <div className="home-grid">
      <article className="home-path"><p className="eyebrow">资产沉淀路径</p><ol><li><span>01</span><div><strong>捕捉沟通</strong><small>IIM、电话、会议与资料</small></div></li><li><span>02</span><div><strong>形成私有需求</strong><small>保留事实、字段和推进状态</small></div></li><li><span>03</span><div><strong>发展为方案资产</strong><small>由你明确确认后再共享</small></div></li></ol></article>
      <article className="home-runtime"><p className="eyebrow">AI 运行方式</p><h2>OpenCode 是统一 Runtime</h2><p>模型、Agent、Skill 与工具执行都经过 OpenCode；工作台负责业务记录、权限与可追溯性。</p><button className="ghost" type="button" onClick={() => go('chat')}>进入 AI 对话</button></article>
    </div>
  </section>;
}
