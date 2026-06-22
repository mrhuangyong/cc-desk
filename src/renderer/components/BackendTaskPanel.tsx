import { useState, useEffect, useRef } from 'react'
import { SubagentDetailDrawer } from './SubagentDetailDrawer'
import { TaskDetailDrawer } from './TaskDetailDrawer'
import { TaskCard } from './TaskPanel'
import { BackendTaskCard } from './BackendTaskCard'
import { SubagentCard } from './SubagentCard'
import type { TaskItem, BackendTask, ContentBlock } from '../types'

interface FoldState { root: boolean }

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
  const [activeSubagent, setActiveSubagent] = useState<BackendTask | null>(null)
  const [activeTask, setActiveTask] = useState<TaskItem | null>(null)
  const subagents = backendTasks.filter(t => t.kind === 'subagent')
  const backends = backendTasks.filter(t => t.kind !== 'subagent')

  // 自动展开：三分区任一出现「未见过的新任务 id」时，把该分区展开。
  // 策略：只展开、不折叠——即便用户手动折叠过，新内容到来仍会撑开（符合「有新内容就展开」预期）。
  // seenIds 跨会话复用（SDK task_id 全局唯一），切换会话回到旧任务不会重复展开。
  const seenIds = useRef<{ task: Set<string>; subagent: Set<string>; backend: Set<string> }>({
    task: new Set(), subagent: new Set(), backend: new Set(),
  })
  useEffect(() => {
    const panels: Array<[keyof typeof seenIds.current, { id: string }[]]> = [
      ['task', tasks],
      ['subagent', subagents],
      ['backend', backends],
    ]
    for (const [key, list] of panels) {
      const seen = seenIds.current[key]
      let hasNew = false
      for (const it of list) {
        if (!seen.has(it.id)) { seen.add(it.id); hasNew = true }
      }
      if (hasNew && folded.root) {
        dispatch({ type: 'SET_PANEL_FOLD', panel: 'root', folded: false })
      }
    }
  }, [tasks, subagents, backends, folded, dispatch])

  const taskVisible = showTodo && tasks.length > 0
  const subagentVisible = showBackendTask && subagents.length > 0
  const bgVisible = showBackendTask && backends.length > 0
  if (!taskVisible && !subagentVisible && !bgVisible) return null

  // 根级折叠：入口已移至 TitleBar，折叠时面板整体不渲染
  if (folded.root) return null

  return (
    <div style={{
      position: 'absolute', top: 12, right: 16, zIndex: 50,
      width: 280, maxHeight: 'calc(100vh - 96px)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* 内层滚动容器:padding 让卡片 boxShadow 不被裁,内容溢出时仅此处滚动。
          maxHeight 跟随视口,内容少时贴合内容,多时触发滚动;panel-scroll 让滚动条可见(全局默认隐藏)。 */}
      <div className="panel-scroll" style={{
        flex: 1, minHeight: 0, overflowY: 'auto',
        paddingRight: 6, paddingLeft: 6, paddingBottom: 6,
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {taskVisible && (
          <TaskCard tasks={tasks} folded={folded.root}
            onToggleFold={() => dispatch({ type: 'SET_PANEL_FOLD', panel: 'root', folded: !folded.root })}
            onClickTask={(task) => setActiveTask(task)} />
        )}
        {subagentVisible && (
          <SubagentCard
            tasks={subagents}
            folded={folded.root}
            onToggleFold={() => dispatch({ type: 'SET_PANEL_FOLD', panel: 'root', folded: !folded.root })}
            onKill={(taskId) => { void window.api.backendTask.kill(activeSessionId, taskId) }}
            onRemove={(taskId) => { void window.api?.backendTask?.remove?.(activeSessionId, taskId); dispatch({ type: 'REMOVE_BACKEND_TASK', sessionId: activeSessionId, taskId }) }}
            onClearFinished={() => {
              const ids = subagents.filter(t => t.status !== 'running').map(t => t.id)
              if (ids.length) void window.api?.backendTask?.remove?.(activeSessionId, ids)
              dispatch({ type: 'CLEAR_FINISHED_BACKEND_TASKS', sessionId: activeSessionId })
            }}
            onClickTask={(task) => setActiveSubagent(task)}
          />
        )}
        {bgVisible && (
          <BackendTaskCard
            tasks={backends}
            folded={folded.root}
            onToggleFold={() => dispatch({ type: 'SET_PANEL_FOLD', panel: 'root', folded: !folded.root })}
            onKill={(taskId) => { void window.api.backendTask.kill(activeSessionId, taskId) }}
            onRemove={(taskId) => { void window.api?.backendTask?.remove?.(activeSessionId, taskId); dispatch({ type: 'REMOVE_BACKEND_TASK', sessionId: activeSessionId, taskId }) }}
            onClearFinished={() => {
              const ids = backends.filter(t => t.status !== 'running').map(t => t.id)
              if (ids.length) void window.api?.backendTask?.remove?.(activeSessionId, ids)
              dispatch({ type: 'CLEAR_FINISHED_BACKEND_TASKS', sessionId: activeSessionId })
            }}
          />
        )}
      </div>
      {/* 子代理详情抽屉:点击面板 subagent 行弹出;fixed 定位,独立于滚动容器 */}
      <SubagentDetailDrawer
        task={activeSubagent}
        outputByToolUseId={subagentOutputByToolUseId ?? {}}
        onClose={() => setActiveSubagent(null)}
      />
      <TaskDetailDrawer
        task={activeTask}
        onClose={() => setActiveTask(null)}
      />
    </div>
  )
}
