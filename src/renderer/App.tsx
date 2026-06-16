import { useState } from 'react'
import { TitleBar } from './components/TitleBar'
import { LeftPanel } from './components/LeftPanel'
import { ChatArea } from './components/ChatArea'
import { RightPanel } from './components/RightPanel'
import { SettingsPage } from './components/settings/SettingsPage'
import { useStore } from './state/store'

export function App() {
  const { state } = useStore()
  const activeProject = state.projects.find(p => p.sessions.some(s => s.id === state.activeSessionId))
  const projectName = activeProject?.name ?? 'cc-desk'

  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(true)  // 右栏默认隐藏

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
