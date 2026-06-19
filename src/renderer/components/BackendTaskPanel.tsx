import { PanelRightOpen, PanelRightClose } from 'lucide-react'
import { TaskCard } from './TaskPanel'
import { BackendTaskCard } from './BackendTaskCard'
import { SubagentCard } from './SubagentCard'
import type { TaskItem, BackendTask, ContentBlock } from '../types'

interface FoldState { root: boolean; taskCard: boolean; subagentCard: boolean; backendTaskCard: boolean }

interface Props {
  tasks: TaskItem[]
  backendTasks: BackendTask[]
  showTodo: boolean
  showBackendTask: boolean
  folded: FoldState
  activeSessionId: string
  // 当前会话的子代理对话输出（按触发它的 Task tool_use id 索引），用于面板→对话流联动
  subagentOutputByToolUseId?: Record<string, ContentBlock[]>
  dispatch: (action: any) => void
}

export function BackendTaskPanel({
  tasks, backendTasks, showTodo, showBackendTask, folded, activeSessionId, subagentOutputByToolUseId, dispatch,
}: Props) {
  const subagents = backendTasks.filter(t => t.kind === 'subagent')
  const backends = backendTasks.filter(t => t.kind !== 'subagent')
  const taskVisible = showTodo && tasks.length > 0
  const subagentVisible = showBackendTask && subagents.length > 0
  const bgVisible = showBackendTask && backends.length > 0
  if (!taskVisible && !subagentVisible && !bgVisible) return null

  // 折叠态：单个圆形小图标，不遮挡内容
  if (folded.root) {
    return (
      <div style={{ position: 'absolute', top: 12, right: 16, zIndex: 50 }}>
        <button onClick={() => dispatch({ type: 'SET_PANEL_FOLD', panel: 'root', folded: false })}
          title="展开面板"
          aria-label="展开面板"
          style={{
            width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--surface-1)',
            borderRadius: 8, cursor: 'pointer', color: 'var(--text-muted)',
            boxShadow: 'var(--shadow-float)',
          }}>
          <PanelRightOpen size={15} />
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
          title="收起面板"
          aria-label="收起面板"
          style={{
            width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--surface-1)',
            borderRadius: 6, cursor: 'pointer', color: 'var(--text-muted)',
          }}>
          <PanelRightClose size={14} />
        </button>
      </div>
      {taskVisible && (
        <TaskCard tasks={tasks} folded={folded.taskCard}
          onToggleFold={() => dispatch({ type: 'SET_PANEL_FOLD', panel: 'taskCard', folded: !folded.taskCard })} />
      )}
      {subagentVisible && (
        <SubagentCard
          tasks={subagents}
          folded={folded.subagentCard}
          onToggleFold={() => dispatch({ type: 'SET_PANEL_FOLD', panel: 'subagentCard', folded: !folded.subagentCard })}
          onKill={(taskId) => { void window.api.backendTask.kill(activeSessionId, taskId) }}
          onRemove={(taskId) => dispatch({ type: 'REMOVE_BACKEND_TASK', sessionId: activeSessionId, taskId })}
          onClearFinished={() => dispatch({ type: 'CLEAR_FINISHED_BACKEND_TASKS', sessionId: activeSessionId })}
        />
      )}
      {bgVisible && (
        <BackendTaskCard
          tasks={backends}
          folded={folded.backendTaskCard}
          onToggleFold={() => dispatch({ type: 'SET_PANEL_FOLD', panel: 'backendTaskCard', folded: !folded.backendTaskCard })}
          onKill={(taskId) => { void window.api.backendTask.kill(activeSessionId, taskId) }}
          onRemove={(taskId) => dispatch({ type: 'REMOVE_BACKEND_TASK', sessionId: activeSessionId, taskId })}
          onClearFinished={() => dispatch({ type: 'CLEAR_FINISHED_BACKEND_TASKS', sessionId: activeSessionId })}
        />
      )}
    </div>
  )
}
