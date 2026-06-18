import { Loader2, Square, X, Trash2, CheckCircle2, AlertCircle } from 'lucide-react'
import type { BackendTask } from '../types'
import { formatSessionTime } from '../utils/formatSessionTime'

const STATUS_LABEL: Record<BackendTask['status'], string> = {
  running: '运行中', completed: '已完成', failed: '已退出', stopped: '已终止',
}

function StatusIcon({ status }: { status: BackendTask['status'] }) {
  const common = { size: 13, style: { flexShrink: 0, marginTop: 1 } }
  switch (status) {
    case 'running': return <Loader2 {...common} style={{ ...common.style, color: 'var(--accent)' }} />
    case 'completed': return <CheckCircle2 {...common} style={{ ...common.style, color: '#34c759' }} />
    case 'failed': return <AlertCircle {...common} style={{ ...common.style, color: '#ff3b30' }} />
    case 'stopped': return <Square {...common} style={{ ...common.style, color: 'var(--text-muted)' }} />
  }
}

interface Props {
  tasks: BackendTask[]
  folded: boolean
  onToggleFold: () => void
  onKill: (taskId: string) => void
  onRemove: (taskId: string) => void
  onClearFinished: () => void
}

export function BackendTaskCard({ tasks, folded, onToggleFold, onKill, onRemove, onClearFinished }: Props) {
  if (tasks.length === 0) return null
  const runningTasks = tasks.filter(t => t.status === 'running')
  const finishedTasks = tasks.filter(t => t.status !== 'running')

  return (
    <div style={{
      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
      borderRadius: 10, boxShadow: 'var(--shadow-float)', fontSize: 12, overflow: 'hidden',
    }}>
      <button onClick={onToggleFold} style={{
        width: '100%', padding: '8px 12px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', background: 'none', border: 'none',
        cursor: 'pointer', color: 'var(--text)', fontWeight: 600,
      }}>
        <span>后台任务</span>
        <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 11 }}>
          {runningTasks.length} 运行 · 共 {tasks.length}
        </span>
      </button>
      {/* 折叠用 max-height 过渡动画：展开时足够大，折叠时 0 */}
      <div style={{
        maxHeight: folded ? 0 : 600,
        opacity: folded ? 0 : 1,
        overflow: 'hidden',
        transition: 'max-height .2s ease, opacity .15s ease',
      }}>
        <div style={{ padding: 4, borderTop: '1px solid var(--border)' }}>
          {/* 运行中 */}
          {runningTasks.map(t => (
            <TaskRow key={t.id} t={t} onKill={onKill} onRemove={onRemove} />
          ))}
          {/* 已结束分组 */}
          {finishedTasks.length > 0 && (
            <>
              {runningTasks.length > 0 && <div style={{ height: 1, background: 'var(--border)', margin: '4px 8px' }} />}
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
          textDecoration: t.status === 'running' ? 'none' : 'none',
        }}>
          {t.command}
        </div>
        <div style={{ color: 'var(--text-faint)', fontSize: 10, marginTop: 2 }}>
          {STATUS_LABEL[t.status]}
          {t.startedAt ? ` · ${formatSessionTime(t.startedAt)}` : ''}
        </div>
      </div>
      {t.status === 'running' ? (
        <button onClick={() => onKill(t.id)} title="终止" style={{
          padding: '2px 6px', color: 'var(--text-muted)', background: 'none',
          border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', fontSize: 11,
          display: 'inline-flex', alignItems: 'center',
        }}>
          <Square size={10} />
        </button>
      ) : (
        <button onClick={() => onRemove(t.id)} title="移除" style={{
          padding: '2px 4px', color: 'var(--text-muted)', background: 'none',
          border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center',
        }}>
          <X size={13} />
        </button>
      )}
    </div>
  )
}
