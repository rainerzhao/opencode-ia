import React, { useEffect, useMemo, useState } from 'react';
import { request } from '../../api/client';

const statuses = [
  ['draft', '待梳理'], ['clarifying', '待澄清'], ['in_progress', '推进中'], ['resolved', '已解决'], ['archived', '已归档']
];
const channels = [['iim', 'IIM 沟通'], ['phone', '电话'], ['meeting', '会议'], ['manual', '手工记录']];
const statusLabel = (value) => Object.fromEntries(statuses)[value] || value;
const channelLabel = (value) => Object.fromEntries(channels)[value] || value;
const blankRequirement = () => ({ title: '', buId: '', scenario: '', description: '', status: 'draft', fieldValues: [] });

function fieldEntries(templates, detail) {
  const saved = new Map((detail?.fieldValues || []).map((item) => [item.templateId, item.value]));
  return templates.map((template) => ({ templateId: template.id, value: saved.has(template.id) ? saved.get(template.id) : template.type === 'boolean' ? false : '' }));
}
function displayTime(value) { try { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); } catch { return value || ''; } }
function serializeFields(templates, form) {
  return templates.map((template) => {
    const name = `field:${template.id}`;
    const raw = template.type === 'boolean' ? form.get(name) === 'true' : form.get(name);
    return { templateId: template.id, value: template.type === 'number' && raw !== '' ? Number(raw) : raw };
  }).filter((entry) => entry.value !== '' || templates.find((item) => item.id === entry.templateId)?.required);
}

function RequirementEditor({ item, businessUnits, templates, onSave, onCancel, busy }) {
  const initial = item || blankRequirement();
  const values = new Map(fieldEntries(templates, item).map((entry) => [entry.templateId, entry.value]));
  function submit(event) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    onSave({ title: form.get('title'), buId: form.get('buId'), scenario: form.get('scenario'), description: form.get('description'), status: form.get('status'), fieldValues: serializeFields(templates, form) });
  }
  return <section className="requirement-editor" aria-label={item?.id ? '编辑需求' : '新建需求'}><div className="requirement-detail__head"><div><p className="eyebrow">{item?.id ? '编辑私有需求' : '建立新的私有资产'}</p><h3>{item?.id ? item.title : '新建需求'}</h3></div><button className="ghost" type="button" onClick={onCancel}>返回详情</button></div><form className="requirement-form" onSubmit={submit}><label>需求标题<input name="title" defaultValue={initial.title} maxLength="200" required /></label><div className="requirement-form__two"><label>业务单元<select name="buId" defaultValue={initial.buId} required><option value="" disabled>选择 BU</option>{businessUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label><label>当前状态<select name="status" defaultValue={initial.status}>{statuses.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label></div><label>适用场景<input name="scenario" defaultValue={initial.scenario || ''} maxLength="100" placeholder="例如：区域门店网络升级" /></label><label>背景、问题与已知约束<textarea name="description" defaultValue={initial.description || ''} maxLength="50000" placeholder="记录已确认的事实、约束与待澄清事项。" /></label>{templates.length > 0 && <fieldset className="controlled-fields"><legend>团队统一字段</legend><p>字段值仅保存在你的私有需求中，字段模板由管理员维护。</p><div className="controlled-fields__grid">{templates.map((template) => <label key={template.id}>{template.label}{template.required && <em>必填</em>}<FieldInput template={template} value={values.get(template.id)} /></label>)}</div></fieldset>}<div className="form-actions"><span className="private-note">默认私有，仅你可见</span><button disabled={busy}>{busy ? '保存中…' : '保存私有需求'}</button></div></form></section>;
}

function FieldInput({ template, value }) {
  const name = `field:${template.id}`;
  if (template.type === 'select') return <select name={name} defaultValue={value} required={template.required}><option value="" disabled>请选择</option>{template.options.map((option) => <option key={option} value={option}>{option}</option>)}</select>;
  if (template.type === 'boolean') return <select name={name} defaultValue={String(value)} required={template.required}><option value="true">是</option><option value="false">否</option></select>;
  return <input name={name} type={template.type === 'number' ? 'number' : 'text'} defaultValue={value} required={template.required} />;
}

function InteractionForm({ requirement, onSave, busy }) {
  function submit(event) { event.preventDefault(); const form = new FormData(event.currentTarget); onSave({ channel: form.get('channel'), content: form.get('content'), occurredAt: new Date(form.get('occurredAt')).toISOString() }); event.currentTarget.reset(); }
  return <form className="interaction-form" onSubmit={submit}><div className="interaction-form__head"><div><p className="eyebrow">事实记录</p><h4>追加原始沟通</h4></div><span>不经 AI 改写</span></div><div className="requirement-form__two"><label>来源<select name="channel" defaultValue="iim">{channels.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label><label>发生时间<input name="occurredAt" type="datetime-local" defaultValue={new Date().toISOString().slice(0, 16)} required /></label></div><label>原始纪要<textarea name="content" placeholder="记录对方原话、电话结论或会议要点。" required /></label><button disabled={busy || !requirement}>记录沟通</button></form>;
}

function Detail({ item, businessUnits, templates, onEdit, onInteraction, busy }) {
  if (!item) return <section className="requirement-detail requirement-detail--empty"><p className="eyebrow">从需求流开始</p><h3>选择一条需求</h3><p>在这里查看私有背景、受控字段与原始沟通记录。</p></section>;
  return <section className="requirement-detail"><div className="requirement-detail__head"><div><p className="eyebrow">{item.buName || businessUnits.find((unit) => unit.id === item.buId)?.name || '未命名 BU'} · 默认私有</p><h3>{item.title}</h3></div><button className="ghost" type="button" onClick={() => onEdit(item)}>编辑</button></div><div className="requirement-meta"><span className={`status-chip status-chip--${item.status}`}>{statusLabel(item.status)}</span><span>最近更新 {displayTime(item.updatedAt)}</span></div>{item.scenario && <div className="detail-block"><h4>适用场景</h4><p>{item.scenario}</p></div>}<div className="detail-block"><h4>背景与约束</h4><p>{item.description || '尚未记录。'}</p></div>{item.fieldValues?.length > 0 && <div className="detail-block"><h4>团队统一字段</h4><dl className="field-values">{item.fieldValues.map((field) => <div key={field.templateId}><dt>{field.label}</dt><dd>{String(field.value)}</dd></div>)}</dl></div>}<div className="timeline"><div className="timeline__head"><div><p className="eyebrow">未经改写的来源</p><h4>原始沟通记录</h4></div><span>{item.interactions?.length || 0} 条</span></div>{item.interactions?.length ? item.interactions.map((entry) => <article key={entry.id}><div><strong>{channelLabel(entry.channel)}</strong><time>{displayTime(entry.occurredAt)}</time></div><p>{entry.content}</p></article>) : <p className="empty-inline">尚未记录沟通。可先把 IIM、电话或会议事实补进来。</p>}</div><InteractionForm requirement={item} onSave={onInteraction} busy={busy} /></section>;
}

function NextActions({ item }) {
  const action = !item ? ['选择一条需求', '查看其现有事实与推进状态。'] : item.status === 'draft' ? ['先澄清问题边界', '补充业务背景，或记录第一次 IIM / 电话沟通。'] : item.status === 'clarifying' ? ['收集待确认事实', '把沟通结论记录为原始材料，再更新需求状态。'] : item.status === 'in_progress' ? ['继续推进方案', '将已形成的工作留在方案与知识资产中。'] : ['核对沉淀结果', '确认是否需要归档，或保持为可追溯的已解决需求。'];
  return <aside className="requirement-actions"><p className="eyebrow">推进建议</p><h3>下一步行动</h3><ol><li><strong>{action[0]}</strong><span>{action[1]}</span></li><li><strong>保持私有边界</strong><span>只有明确发布或授权后，内容才会进入团队资产。</span></li></ol><div className="asset-path"><span>沟通事实</span><i>→</i><span>需求资产</span><i>→</i><span>方案 / 知识</span></div><p className="runtime-note">需要 AI 提炼时，后续仍由 OpenCode Runtime 执行。</p></aside>;
}

export function RequirementsPage({ initialRequirements = null, initialBusinessUnits = null, initialFieldTemplates = null }) {
  const [requirements, setRequirements] = useState(initialRequirements || []); const [businessUnits, setBusinessUnits] = useState(initialBusinessUnits || []); const [templates, setTemplates] = useState(initialFieldTemplates || []); const [selected, setSelected] = useState(initialRequirements?.[0] || null); const [editor, setEditor] = useState(null); const [filters, setFilters] = useState({ q: '', buId: '', status: '' }); const [notice, setNotice] = useState({ text: '', error: false }); const [busy, setBusy] = useState(false); const [loaded, setLoaded] = useState(Boolean(initialRequirements));
  const selectedSummary = useMemo(() => selected?.id ? selected : requirements.find((item) => item.id === selected?.id), [requirements, selected]);
  async function load(nextFilters = filters) { try { const query = new URLSearchParams(Object.entries(nextFilters).filter(([, value]) => value)); const [listed, units, fieldTemplates] = await Promise.all([request(`/api/requirements${query.size ? `?${query}` : ''}`), businessUnits.length ? Promise.resolve({ businessUnits }) : request('/api/requirements/business-units'), templates.length ? Promise.resolve({ fieldTemplates: templates }) : request('/api/requirements/field-templates')]); setRequirements(listed.items || []); if (!businessUnits.length) setBusinessUnits(units.businessUnits || []); if (!templates.length) setTemplates(fieldTemplates.fieldTemplates || []); setLoaded(true); } catch (error) { setNotice({ text: error.message, error: true }); } }
  useEffect(() => { if (!initialRequirements) load(); }, []);
  async function open(item) { try { setBusy(true); setSelected((await request(`/api/requirements/${encodeURIComponent(item.id)}`)).requirement); setEditor(null); } catch (error) { setNotice({ text: error.message, error: true }); } finally { setBusy(false); } }
  async function save(payload) { try { setBusy(true); const body = await request(editor?.id ? `/api/requirements/${encodeURIComponent(editor.id)}` : '/api/requirements', { method: editor?.id ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }); setNotice({ text: editor?.id ? '私有需求已更新。' : '已建立新的私有需求。', error: false }); setEditor(null); await load(); await open(body.requirement); } catch (error) { setNotice({ text: error.message, error: true }); } finally { setBusy(false); } }
  async function addInteraction(payload) { if (!selectedSummary?.id) return; try { setBusy(true); await request(`/api/requirements/${encodeURIComponent(selectedSummary.id)}/interactions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }); setNotice({ text: '原始沟通已记录。', error: false }); await open(selectedSummary); } catch (error) { setNotice({ text: error.message, error: true }); } finally { setBusy(false); } }
  function applyFilters(event) { event.preventDefault(); load(filters); }
  if (editor) return <RequirementEditor item={editor.id ? editor : null} businessUnits={businessUnits} templates={templates} onSave={save} onCancel={() => setEditor(null)} busy={busy} />;
  return <section className="requirements-workbench"><header className="requirements-intro"><div><p className="eyebrow">集团 BU 云解决方案工作台 · 默认私有</p><h2>把每一次沟通，留成可推进的需求</h2><p>从 IIM、电话、会议到文档，先保留事实，再沉淀为个人可追溯资产。</p></div><button type="button" onClick={() => setEditor(blankRequirement())}>新建需求</button></header><form className="requirement-filter" onSubmit={applyFilters}><input aria-label="搜索需求" placeholder="搜索需求、场景或沟通背景" value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} /><select aria-label="筛选业务单元" value={filters.buId} onChange={(event) => setFilters({ ...filters, buId: event.target.value })}><option value="">全部 BU</option>{businessUnits.map((unit) => <option value={unit.id} key={unit.id}>{unit.name}</option>)}</select><select aria-label="筛选状态" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">全部状态</option>{statuses.map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select><button className="ghost" type="submit">筛选</button></form><p className={notice.error ? 'notice error' : 'notice success'} role="status">{notice.text}</p><div className="requirements-layout"><section className="requirement-rail" aria-label="我的需求流"><div className="requirement-rail__head"><div><p className="eyebrow">仅显示你的内容</p><h3>我的需求流</h3></div><span>{requirements.length} 条</span></div><div className="requirement-list">{requirements.length ? requirements.map((item) => <button key={item.id} className={`requirement-item ${selectedSummary?.id === item.id ? 'active' : ''}`} type="button" onClick={() => open(item)}><span className={`status-dot status-dot--${item.status}`} /><strong>{item.title}</strong><small>{item.buName} · {statusLabel(item.status)}</small><time>{displayTime(item.updatedAt)}</time></button>) : <div className="empty"><strong>{loaded ? '还没有匹配的私有需求' : '正在载入需求流…'}</strong><span>从一次真实沟通开始记录。</span></div>}</div></section><Detail item={selectedSummary} businessUnits={businessUnits} templates={templates} onEdit={setEditor} onInteraction={addInteraction} busy={busy} /><NextActions item={selectedSummary} /></div></section>;
}
