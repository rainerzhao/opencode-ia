import React, { useEffect, useState } from 'react';
import { request } from '../../api/client';

function messageFor(error) {
  if (error.code === 'PASSWORD_POLICY') return '密码必须为 12–128 个字符。';
  return error.message || '操作失败，请稍后重试。';
}

export function AdminPage({ user, initialUsers = [] }) {
  const [users, setUsers] = useState(initialUsers);
  const [notice, setNotice] = useState({ text: '', error: false });
  const [resetTarget, setResetTarget] = useState(null);
  const [busyId, setBusyId] = useState('');

  async function load() {
    try {
      const result = await request('/api/admin/users');
      setUsers(result.users);
    } catch (error) {
      setNotice({ text: messageFor(error), error: true });
    }
  }

  useEffect(() => { load(); }, []);

  async function create(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusyId('create');
    setNotice({ text: '', error: false });
    try {
      const data = new FormData(form);
      await request('/api/admin/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(data))
      });
      form.reset();
      setNotice({ text: '账号已创建，请通过安全渠道交付初始密码。', error: false });
      await load();
    } catch (error) {
      setNotice({ text: messageFor(error), error: true });
    } finally {
      setBusyId('');
    }
  }

  async function updateStatus(target) {
    const nextStatus = target.status === 'active' ? 'disabled' : 'active';
    if (target.id === user.id && nextStatus === 'disabled') {
      setNotice({ text: '不能停用当前登录账号。', error: true });
      return;
    }
    if (nextStatus === 'disabled' && !window.confirm(`确认停用 ${target.displayName}？其现有会话将立即失效。`)) return;
    setBusyId(target.id);
    try {
      await request(`/api/admin/users/${encodeURIComponent(target.id)}/status`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: nextStatus })
      });
      setNotice({ text: `已${nextStatus === 'active' ? '启用' : '停用'} ${target.displayName}。`, error: false });
      await load();
    } catch (error) {
      setNotice({ text: messageFor(error), error: true });
    } finally {
      setBusyId('');
    }
  }

  async function revokeSessions(target) {
    if (!window.confirm(`确认撤销 ${target.displayName} 的全部登录会话？`)) return;
    setBusyId(target.id);
    try {
      await request(`/api/admin/users/${encodeURIComponent(target.id)}/sessions/revoke`, { method: 'POST' });
      setNotice({ text: `已撤销 ${target.displayName} 的全部登录会话。`, error: false });
    } catch (error) {
      setNotice({ text: messageFor(error), error: true });
    } finally {
      setBusyId('');
    }
  }

  async function resetPassword(event) {
    event.preventDefault();
    const newPassword = new FormData(event.currentTarget).get('newPassword');
    setBusyId(resetTarget.id);
    try {
      await request(`/api/admin/users/${encodeURIComponent(resetTarget.id)}/password`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newPassword })
      });
      setNotice({ text: `已重置 ${resetTarget.displayName} 的密码，并撤销其全部登录会话。`, error: false });
      setResetTarget(null);
    } catch (error) {
      setNotice({ text: messageFor(error), error: true });
    } finally {
      setBusyId('');
    }
  }

  return <>
    <div className="admin-grid">
      <section className="panel">
        <h3>创建团队账号</h3>
        <p className="muted">不开放自助注册，初始密码请通过安全渠道交付。</p>
        <form className="stack" onSubmit={create}>
          <input name="username" placeholder="用户名" required />
          <input name="displayName" placeholder="显示名称" required />
          <input name="password" type="password" autoComplete="new-password" minLength="12" maxLength="128" placeholder="初始密码（至少 12 位）" required />
          <select name="role"><option value="member">普通成员</option><option value="admin">管理员</option></select>
          <button disabled={busyId === 'create'}>{busyId === 'create' ? '正在创建…' : '创建账号'}</button>
        </form>
      </section>
      <section className="panel">
        <div className="section-head"><div><h3>团队账号</h3><p className="muted">管理密码、登录会话与账号状态。</p></div><button className="ghost" onClick={load}>刷新</button></div>
        <p className={notice.error ? 'notice error' : 'notice success'} role="status">{notice.text}</p>
        <div className="list">{users.map((target) => <article className="user-row" key={target.id}>
          <div><b>{target.displayName}</b><span>{target.username} · {target.role === 'admin' ? '管理员' : '普通成员'} · {target.status === 'active' ? '启用' : '停用'}</span></div>
          <div className="row-actions">
            <button className="ghost" onClick={() => setResetTarget(target)}>重置密码</button>
            <button className="ghost" disabled={busyId === target.id} onClick={() => revokeSessions(target)}>撤销会话</button>
            <button className={target.status === 'active' ? 'danger ghost' : 'ghost'} disabled={busyId === target.id} onClick={() => updateStatus(target)}>{target.status === 'active' ? '停用' : '启用'}</button>
          </div>
        </article>)}</div>
      </section>
    </div>
    {resetTarget && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setResetTarget(null)}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="reset-title">
        <p className="eyebrow">敏感操作</p><h3 id="reset-title">重置 {resetTarget.displayName} 的密码</h3>
        <p className="muted">保存后，该账号当前所有登录会话都会失效。</p>
        <form className="stack" onSubmit={resetPassword}>
          <label>新密码<input name="newPassword" type="password" autoComplete="new-password" minLength="12" maxLength="128" required autoFocus /></label>
          <div className="modal-actions"><button type="button" className="ghost" onClick={() => setResetTarget(null)}>取消</button><button>确认重置</button></div>
        </form>
      </section>
    </div>}
  </>;
}
