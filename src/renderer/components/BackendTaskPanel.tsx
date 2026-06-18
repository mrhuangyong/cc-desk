import { TaskCard } from './TaskPanel'
import { BackendTaskCard } from './BackendTaskCard'
import type { TaskItem, BackendTask } from '../types'

interface FoldState { root: boolean; taskCard: boolean; backendTaskCard: boolean }

interface Props {
  tasks: TaskItem[]
  backendTasks: BackendTask[]
  showTodo: boolean
  showBackendTask: boolean
  folded: FoldState
  activeSessionId: string
  dispatch: (action: any) => void
}

export function BackendTaskPanel({
  tasks, backendTasks, showTodo, showBackendTask, folded, activeSessionId, dispatch,
}: Props) {
  const taskVisible = showTodo && tasks.length > 0
  const bgVisible = showBackendTask && backendTasks.length > 0
  if (!taskVisible && !bgVisible) return null

  if (folded.root) {
    return (
      <div style={{ position: 'absolute', top: 12, right: 16, zIndex: 50 }}>
        <button onClick={() => dispatch({ type: 'SET_PANEL_FOLD', panel: 'root', folded: false })}
          style={{
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '6px 10px', cursor: 'pointer',
            color: 'var(--text-muted)', fontSize: 12,
          }}>
          面板
        </button>
      </div>
    )
  }

  return (
    <div style={{
      position: 'absolute', top: 12, right: 16, zIndex: 50,
      width: 280, maxHeight: 480, overflowY: 'auto',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={() => dispatch({ type: 'SET_PANEL_FOLD', panel: 'root', folded: true })}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', fontSize: 11,
          }}>
          收起
        </button>
      </div>
      {taskVisible && (
        <TaskCard tasks={tasks} folded={folded.taskCard}
          onToggleFold={() => dispatch({ type: 'SET_PANEL_FOLD', panel: 'taskCard', folded: !folded.taskCard })} />
      )}
      {bgVisible && (
        <BackendTaskCard tasks={backendTasks} folded={folded.backendTaskCard}
          onToggleFold={() => dispatch({ type: 'SET_PANEL_FOLD', panel: 'backendTaskCard', folded: !folded.backendTaskCard })}
          onKill={(taskId) => { void window.api.backendTask.kill(activeSessionId, taskId) }} />
      )}
    </div>
  )
}
