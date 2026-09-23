import React, { useEffect, useState } from 'react';
import { request } from '../../api/client';
import { GatewayPanel } from './GatewayPanel';

function messageFor(error) {
  if (error.code === 'PASSWORD_POLICY') return '密码必须为 12–128 个字符。';
  return error.message || '操作失败，请稍后重试。';
}

function RequirementConfiguration({ initialBusinessUnits = [], initialFieldTemplates = [] }) {
  const [businessUnits, setBusinessUnits] = useState(initialBusinessUnits);
  const [fieldTemplates, setFieldTemplates] = useState(initialFieldTemplates);
  const [notice, setNotice] = useState({ text: '', error: false });
  const [busy, setBusy] = useState(false);
  async function load() { try { const [units, fields] = await Promise.all([request('/api/requirements/business-units'), request('/api/requirements/field-templates')]); setBusinessUnits(units.businessUnits || []); setFieldTemplates(fields.fieldTemplates || []); } catch (error) { setNotice({ text: messageFor(error), error: true }); } }
  useEffect(() => { load(); }, []);
  async function createBu(event) { event.preventDefault(); const form = event.currentTarget; setBusy(true); try { await request('/api/requirements/business-units', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: new FormData(form).get('name') }) }); form.reset(); setNotice({ text: '业务单元已加入需求配置。', error: false }); await load(); } catch (error) { setNotice({ text: messageFor(error), error: true }); } finally { setBusy(false); } }
  async function createField(event) { event.preventDefault(); const form = event.currentTarget; const type = form.get('type'); const options = String(form.get('options') || '').split(',').map((item) => item.trim()).filter(Boolean); setBusy(true); try { await request('/api/requirements/field-templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: form.get('key'), label: form.get('label'), type, options: type === 'select' ? options : [], required: form.get('required') === 'on' }) }); form.reset(); setNotice({ text: '统一字段已加入需求配置。', error: false }); await load(); } catch (error) { setNotice({ text: messageFor(error), error: true }); } finally { setBusy(false); } }
  async function archive(kind, id) { if (!window.confirm('确认归档？已有历史需求会保留字段快照。')) return; setBusy(true); try { await request(`/api/requirements/${kind}/${encodeURIComponent(id)}`, { method: 'DELETE' }); setNotice({ text: '配置已归档，历史需求不会被修改。', error: false }); await load(); } catch (error) { setNotice({ text: messageFor(error), error: true }); } finally { setBusy(false); } }
  return <section className="panel requirement-configuration"><div className="section-head"><div><p className="eyebrow">管理员维护 · 成员私有使用</p><h3>需求配置</h3><p className="muted">BU 和字段定义属于团队配置；成员的需求正文、沟通和字段值仍默认私有。</p></div><button className="ghost" type="button" onClick={load} disabled={busy}>刷新配置</button></div><p className={notice.error ? 'notice error' : 'notice success'} role="status">{notice.text}</p><div className="requirement-configuration__grid"><div><h4>业务单元</h4><form className="config-form" onSubmit={createBu}><input name="name" placeholder="例如：零售 BU" maxLength="100" required /><button disabled={busy}>新增业务单元</button></form><div className="config-list">{businessUnits.length ? businessUnits.map((unit) => <div key={unit.id}><span>{unit.name}</span><button className="ghost danger" type="button" disabled={busy} onClick={() => archive('business-units', unit.id)}>归档</button></div>) : <p>请先创建业务单元，成员才可建立需求。</p>}</div></div><div><h4>团队统一字段</h4><form className="config-form config-form--field" onSubmit={createField}><input name="key" placeholder="字段键，例如 priority" pattern="[a-z][a-z0-9_]{0,63}" required /><input name="label" placeholder="展示名称，例如 优先级" maxLength="100" required /><select name="type" defaultValue="text"><option value="text">文本</option><option value="number">数字</option><option value="select">单选</option><option value="boolean">是 / 否</option></select><input name="options" placeholder="单选项用逗号分隔" /><label className="config-check"><input name="required" type="checkbox" />必填</label><button disabled={busy}>新增统一字段</button></form><div className="config-list">{fieldTemplates.length ? fieldTemplates.map((field) => <div key={field.id}><span><strong>{field.label}</strong><small>{field.key} · {field.type}{field.required ? ' · 必填' : ''}</small></span><button className="ghost danger" type="button" disabled={busy} onClick={() => archive('field-templates', field.id)}>归档</button></div>) : <p>没有统一字段时，成员仍可记录核心需求信息。</p>}</div></div></div></section>;
}

export function AdminPage({ user, initialUsers = [], initialBusinessUnits = [], initialFieldTemplates = [] }) {
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

  return <section className="admin-workspace">
    <header className="admin-workspace__header"><div><p className="eyebrow">团队治理</p><h2>团队治理控制台</h2><p>维护账号、统一字段与运行健康；成员的私人内容不会在这里出现。</p></div><span className="wb-status wb-status--attention">受控操作</span></header>
    <GatewayPanel />
    <RequirementConfiguration initialBusinessUnits={initialBusinessUnits} initialFieldTemplates={initialFieldTemplates} />
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
  </section>;
}
