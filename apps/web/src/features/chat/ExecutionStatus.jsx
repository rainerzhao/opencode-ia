import React from 'react';

const labels = { idle: '等待输入', queued: '排队中', running: '正在运行', completed: '已完成', failed: '执行失败', cancelled: '已停止', interrupted: '执行中断', timed_out: '执行超时' };

export function ExecutionStatus({ connection, executionStatus, activeJobId, onCancel }) {
  const canCancel = activeJobId && (executionStatus === 'queued' || executionStatus === 'running');
  return <div className="execution-status" role="status" aria-live="polite">
    <span className={`status-dot status-dot--${connection}`} />
    <span>{connection === 'connected' ? labels[executionStatus] || labels.idle : connection === 'reconnecting' ? '正在重连' : '连接已断开'}</span>
    {canCancel && <button type="button" className="ghost danger" onClick={onCancel}>停止任务</button>}
  </div>;
}
