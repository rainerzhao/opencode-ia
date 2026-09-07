import React, { useEffect, useRef, useState } from 'react';
import { request } from '../../api/client';

const labels = { healthy: '正常', failed: '故障', stopped: '已停止', starting: '启动中', queued: '排队中', running: '运行中', completed: '已完成', cancelled: '已取消', interrupted: '已中断', timed_out: '已超时' };
const active = (job) => ['queued', 'running'].includes(job.status);

export function GatewayPanel({ initialData = null }) {
  const [data, setData] = useState(initialData);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [updated, setUpdated] = useState('');
  const [cancelTarget, setCancelTarget] = useState(null);
  const alive = useRef(false);
  const locked = useRef(false);

  async function refresh() {
    const [health, workers, jobs] = await Promise.all(['health', 'workers', 'jobs'].map((name) => request(`/api/admin/gateway/${name}`)));
    if (alive.current) {
      setData({ health, workers: workers.workers, jobs: jobs.jobs });
      setUpdated(new Date().toLocaleTimeString());
    }
  }

  async function load() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setNotice('');
    try { await refresh(); }
    catch { if (alive.current) setNotice('运行状态暂时无法获取。已有数据可能过期，请刷新重试。'); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }

  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, []);

  async function cancel(job) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setNotice('');
    try {
      await request(`/api/admin/gateway/jobs/${encodeURIComponent(job.id)}/cancel`, { method: 'POST' });
      if (alive.current) setCancelTarget(null);
      await refresh();
      if (alive.current) setNotice('已处理取消请求，请以刷新后的任务状态为准。');
    } catch { if (alive.current) setNotice('无法确认最新任务状态，请刷新核对后再重试。'); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }

  return <section className="panel gateway-panel" aria-labelledby="gateway-title">
    <div className="section-head"><div><p className="eyebrow">服务与任务</p><h3 id="gateway-title">运行管理</h3><p className="muted">仅展示运行元数据，不展示成员的私人标题、正文或密钥。</p></div><button className="ghost" disabled={busy} onClick={load}>{busy ? '更新中…' : '刷新运行状态'}</button></div>
    <p className="notice" role="status">{notice || (updated ? `最近更新 ${updated} · 手动刷新` : '正在获取运行状态…')}</p>
    {data && <>
      <div className="gateway-metrics">
        <div><span>服务状态</span><strong>{data.health.status === 'healthy' ? '服务正常' : '服务降级'}</strong></div>
        <div><span>健康 Worker</span><strong>{data.health.healthyWorkers}</strong></div>
        <div><span>运行任务</span><strong>{data.health.running}</strong></div>
        <div><span>排队任务</span><strong>{data.health.queued}</strong></div>
      </div>
      <div className="gateway-workers">{data.workers.map((worker) => <div key={worker.id}><b>{worker.id}</b><span>{labels[worker.status] || '未知'} · {worker.running}/{worker.capacity} 占用</span></div>)}</div>
      <h4>最近任务</h4><p className="muted">最多显示最近 200 条；取消不会撤销已经发生的外部操作。</p>
      {data.jobs.length === 0 ? <p className="muted">暂无任务</p> : <div className="gateway-jobs">{data.jobs.map((job) => <article key={job.id}>
        <div><b>{labels[job.status] || '未知状态'}</b><code>{job.id}</code><small>成员 {job.userId || '—'} · {job.workerId || '尚未分配 Worker'}</small><small>{job.createdAt || '—'}</small></div>
        {active(job) && <div>{cancelTarget === job.id ? <div className="stack"><p className="muted">确认取消？已发生的外部操作不会撤销。</p><button className="danger ghost" disabled={busy} onClick={() => cancel(job)}>确认取消任务</button><button className="ghost" disabled={busy} onClick={() => setCancelTarget(null)}>保留任务</button></div> : <button className="ghost danger" disabled={busy} onClick={() => setCancelTarget(job.id)}>取消任务</button>}</div>}
      </article>)}</div>}
    </>}
  </section>;
}
