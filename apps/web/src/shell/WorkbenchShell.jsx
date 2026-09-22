import React, { useState } from 'react';
import { AdminPage } from '../features/admin/AdminPage';
import { ChatPage } from '../features/chat/ChatPage';
import { HomePage } from '../features/home/HomePage';
import { KnowledgePage } from '../features/knowledge/KnowledgePage';
import { RequirementsPage } from '../features/requirements/RequirementsPage';
import { SkillsPage } from '../features/skills/SkillsPage';
import { SolutionsPage } from '../features/solutions/SolutionsPage';

const groups = [
  { label: '业务工作区', items: [['home', '工作台首页', 'home'], ['requirements', '需求与场景', 'records'], ['chat', 'AI 平台', 'spark']] },
  { label: '资产工作区', items: [['solutions', '需求方案库', 'layers'], ['skills', 'Skill 资产', 'hex'], ['knowledge', '知识库', 'book']] }
];

const pageContext = {
  home: ['工作台首页', '你的任务、沟通和资产推进概览'],
  requirements: ['需求与场景', '将沟通事实转化为可推进的需求'],
  chat: ['AI 平台', '在私有上下文中持续协作与沉淀'],
  solutions: ['需求方案库', '管理方案版本、来源与共享状态'],
  skills: ['Skill 资产', '开发、验证和启用团队能力'],
  knowledge: ['知识库', '沉淀有来源、可恢复的团队知识'],
  admin: ['账号管理', '管理成员、业务字段和运行状态']
};

function NavIcon({ name }) {
  const paths = {
    home: <><path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5"/><path d="M9.5 21v-7h5v7"/></>,
    records: <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
    spark: <><path d="m12 3 1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3Z"/><path d="m18.5 15 .8 1.8 1.7.7-1.7.7-.8 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z"/></>,
    layers: <><path d="m12 3-9 5 9 5 9-5-9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,
    hex: <><path d="m12 2 8.7 5v10L12 22l-8.7-5V7L12 2Z"/><circle cx="12" cy="12" r="3"/></>,
    book: <><path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H20v17H7.5A3.5 3.5 0 0 0 4 22V5.5Z"/><path d="M4 18.5A3.5 3.5 0 0 1 7.5 15H20"/></>,
    admin: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export function WorkbenchShell({ user, onLogout }) {
  const [page, setPage] = useState('home');
  const navigation = user.role === 'admin' ? [...groups, { label: '团队治理', items: [['admin', '账号管理', 'admin']] }] : groups;
  const views = {
    home: <HomePage go={setPage} />,
    requirements: <RequirementsPage />,
    chat: <ChatPage />,
    solutions: <SolutionsPage />,
    skills: <SkillsPage currentUser={user} />,
    knowledge: <KnowledgePage />,
    admin: <AdminPage user={user} />
  };
  const [title, description] = pageContext[page];

  return <div className="shell wb-shell" data-workbench-shell="desktop">
    <aside className="wb-shell__rail">
      <div className="brand wb-shell__brand"><span className="mark">OC</span><div><strong>云方案工作台</strong><small>OpenCode 团队底座</small></div></div>
      <nav className="wb-shell__nav" aria-label="工作台导航">
        {navigation.map((group) => <section className="wb-shell__group" aria-label={group.label} key={group.label}>
          <p className="wb-shell__group-label">{group.label}</p>
          {group.items.map(([id, label, icon]) => <button className={`wb-shell__nav-button ${page === id ? 'active' : ''}`} onClick={() => setPage(id)} key={id}><NavIcon name={icon} /><span>{label}</span></button>)}
        </section>)}
      </nav>
      <div className="wb-shell__rail-note"><strong>团队空间</strong><span>默认私有 · 人工确认共享</span></div>
    </aside>
    <main className="wb-shell__main">
      <header className="wb-shell__header">
        <div className="wb-shell__context"><h1>{title}</h1><p>{description}</p></div>
        <div className="wb-shell__scope"><span className="wb-status wb-status--active">默认私有</span><div className="user"><span>{(user.displayName || user.username)[0]}</span><div><strong>{user.displayName}</strong><small>{user.role === 'admin' ? '管理员' : '普通成员'}</small></div><button className="ghost" onClick={onLogout}>退出</button></div></div>
      </header>
      <div className="content wb-shell__workspace">{views[page]}</div>
      <footer className="wb-shell__runtime" aria-label="OpenCode Runtime 状态"><i /><strong>OpenCode Runtime</strong><span>运行入口正常</span><span>会话与执行槽位独立管理</span></footer>
    </main>
  </div>;
}
