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

  // 界面主题：始终（含设置页）把 state.theme 落到 document，并持久化。
  // 之前仅 ThemeSwitcher 内驱动，而设置页不渲染 TitleBar/ThemeSwitcher，
  // 导致在设置页改主题无效果。这里在 App 层兜底。
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', state.theme)
    localStorage.setItem('cc-desk-theme', state.theme)
  }, [state.theme])

  // 界面缩放：zoom 字段驱动 document zoom（small=0.85 / normal=1 / large=1.2）
  useEffect(() => {
    const z = state.settings.zoom
    const factor = z === 'small' ? 0.85 : z === 'large' ? 1.2 : 1
    document.documentElement.style.zoom = String(factor)
  }, [state.settings.zoom])

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
    window.api?.projects.get().then(snap => {
      if (snap && snap.projects?.length > 0) {
        dispatch({ type: 'HYDRATE', snapshot: snap })
      }
      // 无论是否恢复，加载完成后才允许保存，避免空 state 在加载前覆盖磁盘
      hydratedRef.current = true
    })
  }, [])

  // 工作区快照持久化：订阅稳定字段，debounce 落盘。
  // 刻意不把 streamingBySession/draft/theme/settings 放进依赖数组——
  // 流式 delta 只动 streamingBySession 不动 projects，故流式过程零写压。
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
    window.api?.onArchiveTick?.(({ beforeTs }) => {
      dispatch({ type: 'ARCHIVE_STALE', beforeTs })
    })
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
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <LeftPanel
          collapsed={leftCollapsed}
        />
        <ChatArea />
        <RightPanel collapsed={rightCollapsed} />
      </div>
    </div>
  )
}
