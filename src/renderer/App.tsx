import { useState, useEffect, useRef } from 'react'
import { TitleBar } from './components/TitleBar'
import { LeftPanel } from './components/LeftPanel'
import { ChatArea } from './components/ChatArea'
import { RightPanel } from './components/RightPanel'
import { SettingsPage } from './components/settings/SettingsPage'
import { useStore } from './state/store'

export function App() {
  const { state, dispatch } = useStore()
  const activeProject = state.projects.find(p => p.sessions.some(s => s.id === state.activeSessionId))
  const projectName = activeProject?.name ?? 'cc-desk'

  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(true)  // 右栏默认隐藏

  // 文件树点击打开文件时，自动展开折叠的右栏。监听 lastFileOpenedSeq 计数：
  // 它只在 OPEN_FILE_TAB（文件树点击）时递增，切 tab/关 tab 不动它，
  // 故不会因无关 tab 变化误触发展开。
  useEffect(() => {
    if (state.lastFileOpenedSeq > 0) setRightCollapsed(false)
  }, [state.lastFileOpenedSeq])

  // 界面主题：始终（含设置页）把 state.theme 落到 document，并持久化。
  // 之前仅 ThemeSwitcher 内驱动，而设置页不渲染 TitleBar/ThemeSwitcher，
  // 导致在设置页改主题无效果。这里在 App 层兜底。
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', state.theme)
    localStorage.setItem('cc-desk-theme', state.theme)
  }, [state.theme])

  // 应用级快捷键：Cmd+,（macOS）/ Ctrl+, 切换设置/工作区
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        if (state.currentView === 'settings') {
          dispatch({ type: 'SET_VIEW', view: 'workspace' })
        } else {
          dispatch({ type: 'SET_SETTINGS_SECTION', section: 'general' })
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state.currentView, dispatch])

  // 应用级快捷键：Cmd+B（macOS）/ Ctrl+B 切换右栏，Cmd+E / Ctrl+E 切换左栏。
  // setState 的 setter 引用稳定，无需进依赖数组。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const k = e.key.toLowerCase()
      if (k === 'b') {
        e.preventDefault()
        setRightCollapsed(c => !c)
      } else if (k === 'e') {
        e.preventDefault()
        setLeftCollapsed(c => !c)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 界面缩放：zoom 只作用于内容区（TitleBar 之外），避免缩放自定义 titleBar
  // 导致其按钮与 macOS 原生红绿灯（不受 CSS zoom 影响）错位。
  const zoomFactor = (() => {
    const z = state.settings.zoom
    return z === 'small' ? 0.85 : z === 'large' ? 1.2 : 1
  })()

  // 工作区持久化的运行时状态：保存防抖定时器 + 是否已完成首次加载的标志
  const saveTimer = useRef<number | null>(null)
  const hydratedRef = useRef(false)

  // 启动时加载持久化设置
  useEffect(() => {
    window.api?.settings.get().then(s => {
      if (s) {
        dispatch({ type: 'SET_SETTINGS', settings: s })
        // 界面主题从设置同步（settings.theme 优先于 localStorage 的默认）
        if (s.theme) dispatch({ type: 'SET_THEME', theme: s.theme as never })
      }
    })
    // 加载持久化的工作区快照（项目/会话/消息/tab/sessionMap），注入 state
    window.api?.projects.get().then(async snap => {
      if (snap && snap.projects?.length > 0) {
        dispatch({ type: 'HYDRATE', snapshot: snap })
      }
      // 无论是否恢复，加载完成后才允许保存，避免空 state 在加载前覆盖磁盘
      hydratedRef.current = true

      // 恢复仍在运行的 session：main 进程的 SDK query 刷新后仍存活，
      // 查询哪些 session 正在迭代，对它们重建 streaming 状态，
      // 把已恢复的 draft message 关联回去，让续推的新 delta 无缝追加。
      try {
        const runningIds = await window.api?.claude?.runningSessions?.()
        if (Array.isArray(runningIds) && runningIds.length > 0) {
          // 从 HYDRATE 后的 projects 里找每个 running session 的最后一条 assistant message（draft）
          const hydrated = snap && snap.projects?.length > 0 ? snap : null
          const projects = hydrated?.projects ?? []
          for (const sid of runningIds) {
            const session = projects.flatMap(p => p.sessions).find(sess => sess.id === sid)
            if (!session || session.messages.length === 0) continue
            const last = session.messages[session.messages.length - 1]
            if (last.role !== 'assistant') continue
            // 把 draft message 的 content 重建为 streaming blocks
            const blocks = (last.content ?? []) as import('./state/reducer').AppState['streamingBySession'][string]['blocks']
            const notices = (last.notices ?? []) as import('./state/reducer').AppState['streamingBySession'][string]['notices']
            dispatch({ type: 'RESTORE_STREAMING', sessionId: sid, draftMessageId: last.id, blocks, notices })
            // 恢复该 session 的后台任务/subagent（main 进程 registry 仍存活）
            try {
              const tasks = await window.api?.backendTask?.list?.(sid)
              if (Array.isArray(tasks) && tasks.length > 0) {
                for (const t of tasks) {
                  dispatch({ type: 'UPSERT_BACKEND_TASK', sessionId: sid, task: t })
                }
              }
            } catch { /* backendTask.list 可能不存在,忽略 */ }
          }
        }
      } catch { /* runningSessions 可能不存在(老版本),忽略 */ }
    })
  }, [])

  // 工作区快照持久化：订阅稳定字段，debounce 落盘。
  // 流式 delta 现在会同步更新 projects.messages 里的 draft message（实时持久化），
  // 使刷新后可恢复到截断点。debounce 500ms 合并高频 delta，写压可控。
  useEffect(() => {
    // 加载未完成前不保存，防止初始化空 state 覆盖磁盘上的快照
    if (!hydratedRef.current) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      window.api?.projects.save({
        projects: state.projects,
        activeSessionId: state.activeSessionId,
        tabsBySession: state.tabsBySession,
        activeTabIdBySession: state.activeTabIdBySession,
        claudeSessionMap: state.claudeSessionMap,
      })
    }, 500)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [
    state.projects,
    state.activeSessionId,
    state.tabsBySession,
    state.activeTabIdBySession,
    state.claudeSessionMap,
  ])

  // 自动归档：监听主进程定时信号，清理陈旧空会话
  useEffect(() => {
    // onArchiveTick 返回 unsubscribe；返回它作 cleanup，避免重 mount 时监听器累加
    const unsubscribe = window.api?.onArchiveTick?.(({ beforeTs }) => {
      dispatch({ type: 'ARCHIVE_STALE', beforeTs })
    })
    return () => { unsubscribe?.() }
  }, [dispatch])

  if (state.currentView === 'settings') {
    return <SettingsPage />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TitleBar
        projectName={projectName}
        leftCollapsed={leftCollapsed}
        rightCollapsed={rightCollapsed}
        onToggleLeft={() => setLeftCollapsed(c => !c)}
        onToggleRight={() => setRightCollapsed(c => !c)}
      />
      <div style={{ flex: 1, display: 'flex', minHeight: 0, zoom: zoomFactor }}>
        <LeftPanel
          collapsed={leftCollapsed}
        />
        <ChatArea />
        <RightPanel collapsed={rightCollapsed} />
      </div>
    </div>
  )
}
