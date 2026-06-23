// src/renderer/components/task-status.tsx
// 任务状态图标与文案的统一来源。
// 三个组件原本各自复制 StatusIcon switch + STATUS_LABEL：
//   - SubagentCard / BackendTaskCard：BackendTask['status'] 4 态（完全相同）
//   - TaskPanel：TaskStatus 6 态（图标/文案/common 样式均不同）
// 状态空间与图标映射都不同，故分两张表，不强求统一到一个 union（会引入复杂泛型）。
import {
  Loader2, Square, CheckCircle2, AlertCircle, XCircle, Circle,
  type LucideIcon,
} from 'lucide-react'
import type { CSSProperties } from 'react'
import type { BackendTask, TaskStatus } from '../types'

// ---- BackendTask 4 态（SubagentCard / BackendTaskCard 共用）----
export const BACKEND_STATUS_LABEL: Record<BackendTask['status'], string> = {
  running: '运行中', completed: '已完成', failed: '已退出', stopped: '已终止',
}

const BACKEND_STATUS_ICON: Record<BackendTask['status'], { Icon: LucideIcon; color: string }> = {
  running: { Icon: Loader2, color: 'var(--accent)' },
  completed: { Icon: CheckCircle2, color: '#34c759' },
  failed: { Icon: AlertCircle, color: '#ff3b30' },
  stopped: { Icon: Square, color: 'var(--text-muted)' },
}

export function BackendStatusIcon({ status }: { status: BackendTask['status'] }) {
  const { Icon, color } = BACKEND_STATUS_ICON[status]
  const common: CSSProperties = { flexShrink: 0, marginTop: 1 }
  return <Icon size={13} className={status === 'running' ? 'cc-spin' : undefined} style={{ ...common, color }} />
}

// ---- TaskStatus 6 态（TaskPanel 用）----
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  pending: '待处理', running: '进行中', completed: '已完成', failed: '失败', killed: '已终止', paused: '已暂停',
}

const TASK_STATUS_ICON: Record<TaskStatus, { Icon: LucideIcon; color: string }> = {
  running: { Icon: Loader2, color: 'var(--accent)' },
  completed: { Icon: CheckCircle2, color: '#34c759' },
  failed: { Icon: XCircle, color: '#ff3b30' },
  killed: { Icon: XCircle, color: 'var(--text-muted)' },
  paused: { Icon: Circle, color: 'var(--text-muted)' },
  pending: { Icon: Circle, color: 'var(--text-muted)' },
}

export function TaskStatusIcon({ status }: { status: TaskStatus }) {
  const entry = TASK_STATUS_ICON[status]
  const { Icon, color } = entry
  const common: CSSProperties = { flexShrink: 0 }
  return <Icon size={13} className={status === 'running' ? 'cc-spin' : undefined} style={{ ...common, color }} />
}
