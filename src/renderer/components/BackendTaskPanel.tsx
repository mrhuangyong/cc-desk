import { useState, useRef, useEffect } from 'react'
import { ListChecks, ChevronRight } from 'lucide-react'
import { SubagentDetailDrawer } from './SubagentDetailDrawer'
import { TaskDetailDrawer } from './TaskDetailDrawer'
import { TaskCard } from './TaskPanel'
import { BackendTaskCard } from './BackendTaskCard'
import { SubagentCard } from './SubagentCard'
import { FoldBadge } from './FoldBadge'
import { useDraggable, type Position } from '../hooks/useDraggable'
import { useStore } from '../state/store'
import type { TaskItem, BackendTask, ContentBlock } from '../types'

interface Props {
  tasks: TaskItem[]
  backendTasks: BackendTask[]
  showTodo: boolean
  showBackendTask: boolean
  activeSessionId: string
  // 当前会话的子代理对话输出（按触发它的 Task tool_use id 索引），用于面板→对话流联动
  subagentOutputByToolUseId?: Record<string, ContentBlock[]>
}

// 默认右上角坐标（挂载时若未开启记忆或无持久化位置时用）
function defaultPosition(): Position {
  const top = 48 // TitleBar 高度 + 间距
  const right = 24
  return { x: window.innerWidth - 36 - right, y: top }
}

export function BackendTaskPanel({
  tasks, backendTasks, showTodo, showBackendTask, activeSessionId, subagentOutputByToolUseId,
}: Props) {
  const { state, dispatch } = useStore()
  const [activeSubagent, setActiveSubagent] = useState<BackendTask | null>(null)
  const [activeTask, setActiveTask] = useState<TaskItem | null>(null)
  const subagents = backendTasks.filter(t => t.kind === 'subagent')
  const backends = backendTasks.filter(t => t.kind !== 'subagent')

  const folded = state.panelFold.root
  const settings = state.settings

  // 初始位置：开启记忆且有持久化坐标 → 用之；否则默认右上角
  const initialPos: Position = (settings.rememberPanelPosition && settings.panelPosition)
    ? settings.panelPosition
    : defaultPosition()

  const { ref, position, onPointerDown } = useDraggable({
    initial: initialPos,
    size: folded ? { width: 36, height: 36 } : { width: 280, height: 400 },
    onChange: (pos) => {
      dispatch({ type: 'SET_PANEL_POSITION', position: pos })
      if (settings.rememberPanelPosition) {
        dispatch({ type: 'SET_SETTINGS', settings: { panelPosition: pos } })
        window.api?.settings?.save({ panelPosition: pos })
      }
    },
  })

  // 记忆开启但当前无 panelPosition 时，首次挂载写入
  useEffect(() => {
    if (settings.rememberPanelPosition && !settings.panelPosition) {
      dispatch({ type: 'SET_SETTINGS', settings: { panelPosition: position } })
      window.api?.settings?.save({ panelPosition: position })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const taskVisible = showTodo && tasks.length > 0
  const subagentVisible = showBackendTask && subagents.length > 0
  const bgVisible = showBackendTask && backends.length > 0
  const totalCount = tasks.length + subagents.length + backends.length

  // 拖动/点击判定：pointerdown 记录起点，click 时位移 < 3px 才视为点击切换折叠。
  // 拖动后 click 仍会触发，但位移大则忽略。
  const downPos = useRef<Position | null>(null)
  const handlePointerDown = (e: React.PointerEvent) => {
    downPos.current = { x: e.clientX, y: e.clientY }
    onPointerDown(e)
  }
  const handleClick = (e: React.MouseEvent) => {
    if (!downPos.current) {
      dispatch({ type: 'SET_PANEL_FOLD', panel: 'root', folded: !folded })
      return
    }
    const dist = Math.hypot(e.clientX - downPos.current.x, e.clientY - downPos.current.y)
    if (dist < 3) dispatch({ type: 'SET_PANEL_FOLD', panel: 'root', folded: !folded })
  }

  const onKill = (taskId: string) => { void window.api.backendTask.kill(activeSessionId, taskId) }
  const onRemove = (taskId: string) => {
    void window.api?.backendTask?.remove?.(activeSessionId, taskId)
    dispatch({ type: 'REMOVE_BACKEND_TASK', sessionId: activeSessionId, taskId })
  }

  return (
    <>
      <div
        ref={ref}
        style={{
          position: 'fixed',
          top: 0, left: 0,
          transform: `translate(${position.x}px, ${position.y}px)`,
          zIndex: 50,
          ...(folded ? {
            width: 36, height: 36, borderRadius: 10, cursor: 'grab',
            background: 'var(--surface-1)', boxShadow: 'var(--shadow-float)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text)',
          } : {
            width: 280, maxHeight: 'calc(100vh - 96px)', borderRadius: 10,
            background: 'var(--surface-1)', boxShadow: 'var(--shadow-float)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }),
        }}
      >
        {folded ? (
          <div
            data-testid="panel-icon"
            onPointerDown={handlePointerDown}
            onClick={handleClick}
            style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', cursor: 'pointer' }}
          >
            <ListChecks size={16} />
            {totalCount > 0 && <FoldBadge count={totalCount} />}
          </div>
        ) : (
          <>
            {/* 标题条：拖把手 + 收起 */}
            <div
              onPointerDown={handlePointerDown}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '6px 10px', cursor: 'grab', borderBottom: '1px solid var(--border-hair)',
                fontWeight: 600, color: 'var(--text)', fontSize: 12,
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <ListChecks size={13} /> 任务面板
              </span>
              <button
                onClick={() => dispatch({ type: 'SET_PANEL_FOLD', panel: 'root', folded: true })}
                onPointerDown={(e) => e.stopPropagation()}
                title="收起"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'inline-flex', padding: 2 }}
              >
                <ChevronRight size={14} />
              </button>
            </div>
            <div className="panel-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '6px 6px' }}>
              {taskVisible && (
                <TaskCard tasks={tasks} onClickTask={(task) => setActiveTask(task)} />
              )}
              {subagentVisible && (
                <SubagentCard
                  tasks={subagents}
                  onKill={onKill}
                  onRemove={onRemove}
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
                  onKill={onKill}
                  onRemove={onRemove}
                  onClearFinished={() => {
                    const ids = backends.filter(t => t.status !== 'running').map(t => t.id)
                    if (ids.length) void window.api?.backendTask?.remove?.(activeSessionId, ids)
                    dispatch({ type: 'CLEAR_FINISHED_BACKEND_TASKS', sessionId: activeSessionId })
                  }}
                />
              )}
              {!taskVisible && !subagentVisible && !bgVisible && (
                <div style={{ padding: '20px 10px', color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>暂无任务</div>
              )}
            </div>
          </>
        )}
      </div>
      <SubagentDetailDrawer
        task={activeSubagent}
        outputByToolUseId={subagentOutputByToolUseId ?? {}}
        onClose={() => setActiveSubagent(null)}
      />
      <TaskDetailDrawer task={activeTask} onClose={() => setActiveTask(null)} />
    </>
  )
}
