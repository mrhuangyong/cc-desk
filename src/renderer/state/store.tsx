import { createContext, useContext, useReducer, type ReactNode } from 'react'
import { reducer, type AppState } from './reducer'
import type { Action } from './actions'
import { mockProjects } from './mockData'

const initialState: AppState = {
  projects: mockProjects, // keep mock for now, will be replaced in Task 11
  activeSessionId: mockProjects[0]?.sessions[0]?.id || '',
  tabsBySession: Object.fromEntries(
    mockProjects.flatMap(p => p.sessions.map(s => [s.id, []]))
  ),
  activeTabIdBySession: Object.fromEntries(
    mockProjects.flatMap(p => p.sessions.map(s => [s.id, null]))
  ),
  theme: ((s) => (s && ['codex-light','codex-warm','codex-cool','codex-paper'].includes(s) ? s : 'codex-light'))(
    localStorage.getItem('cc-desk-theme')
  ) as AppState['theme'],
  draft: { text: '' },
  currentView: 'workspace',
  activeSettingsSection: 'general',
  streamingBySession: {},
  settings: { apiKey: '', model: 'sonnet', cwd: '' },
}

interface StoreContextValue {
  state: AppState
  dispatch: React.Dispatch<Action>
}

const StoreContext = createContext<StoreContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)
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
