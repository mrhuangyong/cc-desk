import { TitleBar } from './components/TitleBar'
import { LeftPanel } from './components/LeftPanel'
import { ChatArea } from './components/ChatArea'
import { RightPanel } from './components/RightPanel'
import { useStore } from './state/store'

export function App() {
  const { state } = useStore()
  const activeProject = state.projects.find(p => p.sessions.some(s => s.id === state.activeSessionId))
  const projectName = activeProject?.name ?? 'cc-desk'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TitleBar projectName={projectName} />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <LeftPanel />
        <ChatArea />
        <RightPanel />
      </div>
    </div>
  )
}
