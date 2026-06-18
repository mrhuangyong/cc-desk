// src/renderer/components/TaskPanel.tsx
// 工作区右上角悬浮 task 面板：显示当前会话的 Claude task 列表。
// 受「显示待办」设置控制（state.settings.showTodo）。
import { useStore } from '../state/store'
import { CheckCircle2, Loader2, Circle, AlertCircle, XCircle } from 'lucide-react'
import type { TaskStatus } from '../types'

function StatusIcon({ status }: { status: TaskStatus }) {
  const common = { size: 13, style: { flexShrink: 0 } }
  switch (status) {
    case 'running': return <Loader2 {...common} style={{ ...common.style, color: 'var(--accent)' }} />
    case 'completed': return <CheckCircle2 {...common} style={{ ...common.style, color: '#34c759' }} />
    case 'failed': return <XCircle {...common} style={{ ...common.style, color: '#ff3b30' }} />
    case 'killed': return <XCircle {...common} style={{ ...common.style, color: 'var(--text-muted)' }} />
    case 'paused': return <Circle {...common} style={{ ...common.style, color: 'var(--text-muted)' }} />
    default: return <Circle {...common} style={{ ...common.style, color: 'var(--text-muted)' }} />
  }
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: '待处理', running: '进行中', completed: '已完成', failed: '失败', killed: '已终止', paused: '已暂停',
}

export function TaskPanel() {
  const { state } = useStore()
  if (!state.settings.showTodo) return null
  const tasks = state.tasksBySession[state.activeSessionId] ?? []
  if (tasks.length === 0) return null

  const running = tasks.filter(t => t.status === 'running').length
  const done = tasks.filter(t => t.status === 'completed').length

  return (
    <div style={{
      position: 'absolute', top: 12, right: 16, zIndex: 50,
      width: 280, maxHeight: 320, overflowY: 'auto',
      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
      borderRadius: 10, boxShadow: 'var(--shadow-float)',
      fontSize: 12,
    }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text)', fontWeight: 600 }}>
        <span>任务</span>
        <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 11 }}>
          {running} 进行 · {done} 完成 · 共 {tasks.length}
        </span>
      </div>
      <div style={{ padding: 4 }}>
        {tasks.map(t => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 8px', borderRadius: 6 }}>
            <div style={{ marginTop: 1 }}><StatusIcon status={t.status} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.description || '(无描述)'}</div>
              <div style={{ color: 'var(--text-faint)', fontSize: 10, marginTop: 2 }}>{STATUS_LABEL[t.status]}{t.taskType ? ` · ${t.taskType}` : ''}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
