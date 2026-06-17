import { createContext, useContext, useReducer, type ReactNode } from 'react'
import { reducer, type AppState } from './reducer'
import type { Action } from './actions'
import type { Project } from '../types'

// 真实会话来自 Claude（通过 INIT_SESSIONS 等动作注入），初始为空
function makeInitialState(seedProjects?: Project[]): AppState {
  if (seedProjects && seedProjects.length > 0) {
    const firstSessionId = seedProjects[0]?.sessions[0]?.id ?? ''
    return {
      projects: seedProjects,
      activeSessionId: firstSessionId,
      tabsBySession: Object.fromEntries(seedProjects.flatMap(p => p.sessions.map(s => [s.id, []]))),
      activeTabIdBySession: Object.fromEntries(seedProjects.flatMap(p => p.sessions.map(s => [s.id, null]))),
      theme: themeFromStorage(),
      draft: { text: '' },
      currentView: 'workspace',
      activeSettingsSection: 'general',
      streamingBySession: {},
      settings: {
        apiKey: '', model: 'model-sonnet', cwd: '', providers: [], models: [], modelRoleMap: {},
        theme: 'codex-light', lang: 'zh-CN', zoom: 'normal', proxy: '', inheritTerminal: true,
        terminalFont: 'MesloLGS NF, monospace', taskNotify: true, notifySound: true, queueMode: 'queue',
        showThinking: false, showTodo: false, autoArchive: true, archiveDays: '7', dataPath: '',
        codePreview: { lightTheme: 'GitHub Light', darkTheme: 'GitHub Dark', showLineNumbers: true, wordWrap: false, fontSize: 12 },
        skills: [], mcpServers: [], plugins: [], commands: [], hooks: [],
      },
      claudeSessionMap: {},
      pendingDialog: null,
    }
  }
  return {
    projects: [],
    activeSessionId: '',
    tabsBySession: {},
    activeTabIdBySession: {},
    theme: themeFromStorage(),
    draft: { text: '' },
    currentView: 'workspace',
    activeSettingsSection: 'general',
    streamingBySession: {},
    settings: {
      apiKey: '', model: 'model-sonnet', cwd: '', providers: [], models: [], modelRoleMap: {},
      theme: 'codex-light', lang: 'zh-CN', zoom: 'normal', proxy: '', inheritTerminal: true,
      terminalFont: 'MesloLGS NF, monospace', taskNotify: true, notifySound: true, queueMode: 'queue',
      showThinking: false, showTodo: false, autoArchive: true, archiveDays: '7', dataPath: '',
      codePreview: { lightTheme: 'GitHub Light', darkTheme: 'GitHub Dark', showLineNumbers: true, wordWrap: false, fontSize: 12 },
      skills: [], mcpServers: [], plugins: [], commands: [], hooks: [],
    },
    claudeSessionMap: {},
    pendingDialog: null,
  }
}

function themeFromStorage(): AppState['theme'] {
  return ((s) => (s && ['codex-light','codex-warm','codex-cool','codex-paper'].includes(s) ? s : 'codex-light'))(
    localStorage.getItem('cc-desk-theme')
  ) as AppState['theme']
}

interface StoreContextValue {
  state: AppState
  dispatch: React.Dispatch<Action>
}

const StoreContext = createContext<StoreContextValue | null>(null)

// initialProjects 仅用于测试同步播种；生产环境会话由 Claude 通过 INIT_SESSIONS 注入。
export function AppProvider({ children, initialProjects }: { children: ReactNode; initialProjects?: Project[] }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => makeInitialState(initialProjects))
  return (
    <StoreContext.Provider value={{ state, dispatch }}>
      {children}
    </StoreContext.Provider>
  )
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within AppProvider')
  return ctx
}
