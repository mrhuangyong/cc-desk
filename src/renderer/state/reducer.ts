import type { Action } from './actions'
import type { Project, Session, Tab, ThemeId } from '../types'

export interface AppState {
  projects: Project[]
  activeSessionId: string
  // 每个 session 独立的 Tab 组
  tabsBySession: Record<string, Tab[]>
  activeTabId: string | null
  theme: ThemeId
}

let idCounter = 0
function nextId(prefix: string): string {
  idCounter += 1
  return `${prefix}${idCounter}`
}

// 判断会话是否为空（消息数为 0）
function isEmptySession(s: Session): boolean {
  return s.messages.length === 0
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'DELETE_PROJECT': {
      const projects = state.projects.filter(p => p.id !== action.projectId)
      return { ...state, projects }
    }
    case 'DELETE_SESSION': {
      const projects = state.projects.map(p =>
        p.id === action.projectId
          ? { ...p, sessions: p.sessions.filter(s => s.id !== action.sessionId) }
          : p
      )
      return { ...state, projects }
    }
    case 'ADD_SESSION': {
      const project = state.projects.find(p => p.id === action.projectId)
      if (!project) return state
      // 去重：已有空会话则不新建，激活它
      const existingEmpty = project.sessions.find(isEmptySession)
      if (existingEmpty) {
        const tabsBySession = { ...state.tabsBySession }
        if (!tabsBySession[existingEmpty.id]) tabsBySession[existingEmpty.id] = []
        return { ...state, activeSessionId: existingEmpty.id, tabsBySession }
      }
      const newSession: Session = { id: nextId('s'), title: '新会话', messages: [] }
      const projects = state.projects.map(p =>
        p.id === action.projectId
          ? { ...p, sessions: [...p.sessions, newSession] }
          : p
      )
      const tabsBySession = { ...state.tabsBySession, [newSession.id]: [] }
      return { ...state, projects, activeSessionId: newSession.id, tabsBySession }
    }
    case 'SELECT_SESSION': {
      return { ...state, activeSessionId: action.sessionId }
    }
    case 'OPEN_FILE_TAB': {
      const tabs = state.tabsBySession[state.activeSessionId] ?? []
      // 去重：同文件已开则切过去
      const existing = tabs.find(t => t.type === 'file' && t.filePath === action.filePath)
      if (existing) {
        return { ...state, activeTabId: existing.id }
      }
      const newTab: Tab = {
        id: nextId('t'),
        type: 'file',
        title: action.fileName,
        filePath: action.filePath
      }
      return {
        ...state,
        tabsBySession: { ...state.tabsBySession, [state.activeSessionId]: [...tabs, newTab] },
        activeTabId: newTab.id
      }
    }
    case 'OPEN_TAB': {
      const tabs = state.tabsBySession[state.activeSessionId] ?? []
      const newTab: Tab = {
        id: nextId('t'),
        type: action.tabType,
        title: action.tabType === 'browser' ? '浏览器' : action.tabType === 'terminal' ? '终端' : '文件'
      }
      return {
        ...state,
        tabsBySession: { ...state.tabsBySession, [state.activeSessionId]: [...tabs, newTab] },
        activeTabId: newTab.id
      }
    }
    case 'CLOSE_TAB': {
      const tabs = (state.tabsBySession[state.activeSessionId] ?? []).filter(t => t.id !== action.tabId)
      let activeTabId = state.activeTabId
      if (state.activeTabId === action.tabId) {
        activeTabId = tabs.length > 0 ? tabs[tabs.length - 1].id : null
      }
      return { ...state, tabsBySession: { ...state.tabsBySession, [state.activeSessionId]: tabs }, activeTabId }
    }
    case 'SELECT_TAB': {
      return { ...state, activeTabId: action.tabId }
    }
    case 'SET_THEME': {
      return { ...state, theme: action.theme }
    }
    default:
      return state
  }
}
