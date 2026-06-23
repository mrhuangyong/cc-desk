import { X, Trash2, Terminal, Square } from 'lucide-react'
import type { BackendTask } from '../types'
import { formatSessionTime } from '../utils/formatSessionTime'
import { Tooltip } from './Tooltip'
import { BackendStatusIcon as StatusIcon, BACKEND_STATUS_LABEL as STATUS_LABEL } from './task-status'

interface Props {
  tasks: BackendTask[]
  onKill: (taskId: string) => void
  onRemove: (taskId: string) => void
  onClearFinished: () => void
}

export function BackendTaskCard({ tasks, onKill, onRemove, onClearFinished }: Props) {
  if (tasks.length === 0) return null
  const runningTasks = tasks.filter(t => t.status === 'running')
  const finishedTasks = tasks.filter(t => t.status !== 'running')

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text)', fontWeight: 600 }}>
          <Terminal size={13} /> 后台任务
        </span>
        <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 11 }}>
          {runningTasks.length} 运行 · 共 {tasks.length}
        </span>
      </div>
      <div style={{ padding: 4 }}>
        {runningTasks.map(t => (
          <TaskRow key={t.id} t={t} onKill={onKill} onRemove={onRemove} />
        ))}
        {finishedTasks.length > 0 && (
          <>
            {runningTasks.length > 0 && <div style={{ height: 1, background: 'var(--border-hair)', margin: '4px 8px' }} />}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px' }}>
              <span style={{ color: 'var(--text-faint)', fontSize: 10 }}>已结束 · {finishedTasks.length}</span>
              <button onClick={onClearFinished} title="清除已结束" style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                padding: '2px 6px', color: 'var(--text-muted)', background: 'none',
                border: 'none', cursor: 'pointer', fontSize: 10,
              }}>
                <Trash2 size={11} /> 清除
              </button>
            </div>
            {finishedTasks.map(t => (
              <TaskRow key={t.id} t={t} onKill={onKill} onRemove={onRemove} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function TaskRow({ t, onKill, onRemove }: {
  t: BackendTask
  onKill: (id: string) => void
  onRemove: (id: string) => void
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 8,
      padding: '6px 8px', borderRadius: 6,
    }}>
      <StatusIcon status={t.status} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          color: t.status === 'running' ? 'var(--text)' : 'var(--text-muted)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {t.command}
        </div>
        <div style={{ color: 'var(--text-faint)', fontSize: 10, marginTop: 2 }}>
          {STATUS_LABEL[t.status]}
          {t.startedAt ? ` · ${formatSessionTime(t.startedAt)}` : ''}
        </div>
      </div>
      {t.status === 'running' ? (
        <Tooltip label="终止">
          <button aria-label="终止" onClick={() => onKill(t.id)} style={{
            padding: '2px 6px', color: 'var(--text-muted)', background: 'var(--surface-2)',
            border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11,
            display: 'inline-flex', alignItems: 'center',
          }}>
            <Square size={10} />
          </button>
        </Tooltip>
      ) : (
        <Tooltip label="移除">
          <button aria-label="移除" onClick={() => onRemove(t.id)} style={{
            padding: '2px 4px', color: 'var(--text-muted)', background: 'none',
            border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center',
          }}>
            <X size={13} />
          </button>
        </Tooltip>
      )}
    </div>
  )
}
