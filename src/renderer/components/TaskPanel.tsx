// src/renderer/components/TaskPanel.tsx
// 任务卡片：显示当前会话的 Claude task 列表，嵌入 BackendTaskPanel 使用。
import { CheckCircle2, Loader2, Circle, AlertCircle, XCircle, ListTodo } from 'lucide-react'
import type { TaskStatus, TaskItem } from '../types'

function StatusIcon({ status }: { status: TaskStatus }) {
  const common = { size: 13, style: { flexShrink: 0 } }
  switch (status) {
    case 'running': return <Loader2 {...common} className="cc-spin" style={{ ...common.style, color: 'var(--accent)' }} />
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

interface TaskCardProps {
  tasks: TaskItem[]
  onClickTask?: (task: TaskItem) => void
}

export function TaskCard({ tasks, onClickTask }: TaskCardProps) {
  if (tasks.length === 0) return null
  const running = tasks.filter(t => t.status === 'running').length
  const done = tasks.filter(t => t.status === 'completed').length

  return (
    <div>
      {/* 静态标题行：不再可点折叠 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 10px',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text)', fontWeight: 600 }}>
          <ListTodo size={13} /> 任务
        </span>
        <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 11 }}>
          {running} 进行 · {done} 完成 · 共 {tasks.length}
        </span>
      </div>
      <div style={{ padding: 4 }}>
        {[...tasks].sort((a, b) => (a.id || '').localeCompare(b.id || '', undefined, { numeric: true })).map(t => (
          <div
            key={t.id}
            onClick={onClickTask ? () => onClickTask(t) : undefined}
            className="cc-task-row"
            style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 8px', borderRadius: 6, cursor: onClickTask ? 'pointer' : 'default' }}
          >
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
