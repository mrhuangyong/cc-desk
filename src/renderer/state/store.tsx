import { createContext, useContext, useReducer, type ReactNode } from 'react'
import { reducer, type AppState } from './reducer'
import type { Action } from './actions'
import type { Project } from '../types'

// 真实会话来自 Claude（通过 INIT_SESSIONS 等动作注入），初始为空
function makeInitialState(seedProjects?: Project[]): AppState {
  // 共享默认值：两分支仅 projects / activeSessionId / 两张会话级 map 不同，其余全部一致。
  const base: AppState = {
    projects: [],
    activeSessionId: '',
    tabsBySession: {},
    activeTabIdBySession: {},
    theme: themeFromStorage(),
    draft: { doc: null, attachments: [] },
    currentView: 'workspace',
    activeSettingsSection: 'general',
    streamingBySession: {},
    settings: {
      apiKey: '', model: 'model-sonnet', cwd: '', providers: [], models: [], modelRoleMap: {},
      theme: 'codex-light', lang: 'zh-CN', zoom: 'normal', chatWidth: 'wide', proxy: '', inheritTerminal: true,
      terminalFont: 'MesloLGS NF, monospace', taskNotify: true, notifySound: true, notifyOnComplete: true, notifyOnError: true, notifyOnConfirm: true, notifyOnPermission: true, queueMode: 'queue',
      showThinking: true, showTodo: true, showBackendTask: true, rememberPanelPosition: true, autoArchive: true, archiveDays: '7', devTools: false,
      codePreview: { lightTheme: 'GitHub Light', darkTheme: 'GitHub Dark', showLineNumbers: true, wordWrap: false, fontSize: 12 },
      skills: [], mcpServers: [], plugins: [], commands: [], hooks: [],
    },
    claudeSessionMap: {},
    pendingDialog: null,
    dirtyTabIds: {},
    lastFileOpenedSeq: 0,
    queueBySession: {},
    tasksBySession: {},
    backendTasksBySession: {},
    panelFold: { root: true },
    panelPosition: { x: 0, y: 0 },
    subagentOutputBySession: {},
    planBySession: {},
    abortedBySession: {},
    contextUsageBySession: {},
    editingMessageId: null, editingQueueId: null,
    updateStatus: { state: 'idle' },
    reviewByProject: {},
  }
  if (!seedProjects || seedProjects.length === 0) return base
  const sessions = seedProjects.flatMap(p => p.sessions)
  return {
    ...base,
    projects: seedProjects,
    activeSessionId: sessions[0]?.id ?? '',
    tabsBySession: Object.fromEntries(sessions.map(s => [s.id, []])),
    activeTabIdBySession: Object.fromEntries(sessions.map(s => [s.id, null])),
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
