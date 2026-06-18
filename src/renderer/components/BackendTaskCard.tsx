import { Loader2, Square } from 'lucide-react'
import type { BackendTask } from '../types'
import { formatSessionTime } from '../utils/formatSessionTime'

const STATUS_LABEL: Record<BackendTask['status'], string> = {
  running: '运行中', completed: '已完成', failed: '已退出', stopped: '已终止',
}

interface Props {
  tasks: BackendTask[]
  folded: boolean
  onToggleFold: () => void
  onKill: (taskId: string) => void
}

export function BackendTaskCard({ tasks, folded, onToggleFold, onKill }: Props) {
  if (tasks.length === 0) return null
  const running = tasks.filter(t => t.status === 'running').length
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
          {running} 运行 · 共 {tasks.length}
        </span>
      </button>
      {!folded && (
        <div style={{ padding: 4, borderTop: '1px solid var(--border)' }}>
          {tasks.map(t => (
            <div key={t.id} style={{
              display: 'flex', alignItems: 'flex-start', gap: 8,
              padding: '6px 8px', borderRadius: 6,
            }}>
              {t.status === 'running' && (
                <Loader2 size={13} style={{ flexShrink: 0, marginTop: 1, color: 'var(--accent)' }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  color: 'var(--text)', overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {t.command}
                </div>
                <div style={{ color: 'var(--text-faint)', fontSize: 10, marginTop: 2 }}>
                  {STATUS_LABEL[t.status]}
                  {t.startedAt ? ` · ${formatSessionTime(t.startedAt)}` : ''}
                </div>
              </div>
              {t.status === 'running' && (
                <button onClick={() => onKill(t.id)} title="终止" style={{
                  padding: '2px 6px', color: 'var(--text-muted)', background: 'none',
                  border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', fontSize: 11,
                }}>
                  <Square size={10} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
