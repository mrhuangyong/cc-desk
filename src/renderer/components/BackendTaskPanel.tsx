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
  // 实际渲染的折叠态：延迟跟随 state.panelFold.root，让"退出"动画先播完再切换 DOM。
  // folded（目标态）切到 true（折叠）时：面板先播退出动画（向右上收缩），结束后 displayFolded 才变 true 显示图标。
  // 展开则立即响应（图标无需退出动画）。
  const targetFolded = state.panelFold.root
  const [displayFolded, setDisplayFolded] = useState(targetFolded)
  const [exiting, setExiting] = useState(false)   // 面板正在播退出动画
  useEffect(() => {
    if (targetFolded === displayFolded) return
    if (targetFolded) {
      // 折叠：先播退出动画，260ms 后再切到图标
      setExiting(true)
      const t = setTimeout(() => { setExiting(false); setDisplayFolded(true) }, 260)
      return () => clearTimeout(t)
    } else {
      // 展开：立即显示面板（播进入动画）
      setDisplayFolded(false)
    }
  }, [targetFolded])
  const subagents = backendTasks.filter(t => t.kind === 'subagent')
  const backends = backendTasks.filter(t => t.kind !== 'subagent')

  const folded = state.panelFold.root
  const settings = state.settings

  // 初始位置：开启记忆且有持久化坐标 → 用之；否则默认右上角。
  // 注意 initialPos 仅在首次挂载被 useDraggable 的 useState 采用；后续 settings.panelPosition
  // 变化不会移动面板（位置由用户拖动驱动）。这是有意的——避免设置页改动导致面板跳动。
  const initialPos: Position = (settings.rememberPanelPosition && settings.panelPosition)
    ? settings.panelPosition
    : defaultPosition()

  const { ref, position, onPointerDown } = useDraggable({
    initial: initialPos,
    size: displayFolded ? { width: 36, height: 36 } : { width: 280, height: 400 },
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
          // 注意：translate（拖动定位）在外层 transform；scale 动画挂在内层，避免互相覆盖。
          zIndex: 50,
          // 外层尺寸跟随 displayFolded（退出动画期间保持面板尺寸，结束后才缩成图标）
          ...(displayFolded ? {
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
        {/* 内层动画层：scale 锚定右上角。
            - 展开（displayFolded=false, 非退出）：panel-expand，scale 0→1，从右上角向左下生长。
            - 折叠退出（exiting）：panel-exit，scale 1→0，向右上角收缩（"从左下到右上"收回）。
            - 图标态（displayFolded=true）：panel-collapse，图标从右上角点弹出。
            与外层 translate 分层，scale 不覆盖拖动定位。 */}
        <div style={{
          transformOrigin: 'top right',
          animation: exiting ? 'panel-exit .26s cubic-bezier(.4,0,.2,1) forwards'
            : displayFolded ? 'panel-collapse .26s cubic-bezier(.22,1,.36,1)'
            : 'panel-expand .32s cubic-bezier(.22,1,.36,1)',
          width: '100%', height: '100%', minHeight: 0,
          display: 'flex', flexDirection: 'column',
        }}>
        {displayFolded ? (
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
            {/* 标题条：拖把手 + 点击折叠。点击（位移<3px）触发折叠，拖动则移动面板。 */}
            <div
              onPointerDown={handlePointerDown}
              onClick={handleClick}
              title="点击收起"
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
                onClick={(e) => { e.stopPropagation(); dispatch({ type: 'SET_PANEL_FOLD', panel: 'root', folded: true }) }}
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
      </div>
      {/* 折叠/展开方向性动画：锚点统一右上角（transform-origin: top right）。
          - panel-expand（展开）：scale 0→1，内容从右上角向左下方生长（"右上到左下"）。
          - panel-exit（折叠退出）：scale 1→0，内容向右上角收缩（"左下到右上"收回）。
          - panel-collapse（图标态）：scale 0→1，图标从右上角点弹出，承接面板收回的余韵。 */}
      <style>{`
        @keyframes panel-expand {
          from { transform: scale(.1); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        @keyframes panel-exit {
          from { transform: scale(1); opacity: 1; }
          to { transform: scale(.1); opacity: 0; }
        }
        @keyframes panel-collapse {
          from { transform: scale(.1); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
      `}</style>
      <SubagentDetailDrawer
        task={activeSubagent}
        outputByToolUseId={subagentOutputByToolUseId ?? {}}
        onClose={() => setActiveSubagent(null)}
      />
      <TaskDetailDrawer task={activeTask} onClose={() => setActiveTask(null)} />
    </>
  )
}
