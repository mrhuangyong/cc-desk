import type { Action } from './actions'
import type { Draft, Project, Session, Tab, ThemeId } from '../types'

export interface AppState {
  projects: Project[]
  activeSessionId: string
  // 每个 session 独立的 Tab 组
  tabsBySession: Record<string, Tab[]>
  // 每个会话当前激活的 Tab（key = sessionId）
  activeTabIdBySession: Record<string, string | null>
  theme: ThemeId
  // 对话输入框草稿：文本 + 可选拾取附件
  draft: Draft
}

// TODO: idCounter is module-level mutable state — non-deterministic IDs. Acceptable for prototype; thread through state if persistence/time-travel needed later.
let idCounter = 0
function nextId(prefix: string): string {
  idCounter += 1
  return `${prefix}${idCounter}`
}

// 读取当前会话激活的 Tab id
function activeTabIdOf(state: AppState): string | null {
  return state.activeTabIdBySession[state.activeSessionId] ?? null
}

// 判断会话是否为空（消息数为 0）
function isEmptySession(s: Session): boolean {
  return s.messages.length === 0
}

// 删除后，找一个存活的会话 id 作为新的 activeSessionId
function pickSurvivingSessionId(projects: Project[], excludedId: string): string | null {
  for (const p of projects) {
    const found = p.sessions.find(s => s.id !== excludedId)
    if (found) return found.id
  }
  return null
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'DELETE_PROJECT': {
      const projects = state.projects.filter(p => p.id !== action.projectId)
      // 若激活会话在被删项目里，切到存活会话
      const removedProject = state.projects.find(p => p.id === action.projectId)
      const activeWasInRemoved = removedProject?.sessions.some(s => s.id === state.activeSessionId)
      let activeSessionId = state.activeSessionId
      if (activeWasInRemoved) {
        activeSessionId = pickSurvivingSessionId(projects, state.activeSessionId) ?? state.activeSessionId
      }
      return { ...state, projects, activeSessionId }
    }
    case 'DELETE_SESSION': {
      const projects = state.projects.map(p =>
        p.id === action.projectId
          ? { ...p, sessions: p.sessions.filter(s => s.id !== action.sessionId) }
          : p
      )
      // 若删的是当前激活会话，自动切到另一个存活会话
      let activeSessionId = state.activeSessionId
      if (state.activeSessionId === action.sessionId) {
        activeSessionId = pickSurvivingSessionId(projects, action.sessionId) ?? state.activeSessionId
      }
      return { ...state, projects, activeSessionId }
    }
    case 'ADD_SESSION': {
      const project = state.projects.find(p => p.id === action.projectId)
      if (!project) return state
      // 去重：已有空会话则不新建，激活它
      const existingEmpty = project.sessions.find(isEmptySession)
      if (existingEmpty) {
        const tabsBySession = { ...state.tabsBySession }
        if (!tabsBySession[existingEmpty.id]) tabsBySession[existingEmpty.id] = []
        const activeTabIdBySession = {
          ...state.activeTabIdBySession,
          [existingEmpty.id]: state.activeTabIdBySession[existingEmpty.id] ?? null
        }
        return { ...state, activeSessionId: existingEmpty.id, tabsBySession, activeTabIdBySession }
      }
      const newSession: Session = { id: nextId('s'), title: '新会话', messages: [] }
      const projects = state.projects.map(p =>
        p.id === action.projectId
          ? { ...p, sessions: [...p.sessions, newSession] }
          : p
      )
      const tabsBySession = { ...state.tabsBySession, [newSession.id]: [] }
      const activeTabIdBySession = { ...state.activeTabIdBySession, [newSession.id]: null }
      return { ...state, projects, activeSessionId: newSession.id, tabsBySession, activeTabIdBySession }
    }
    case 'SELECT_SESSION': {
      // 不重算每会话活跃 Tab——它们各自独立保留。仅保证目标会话有条目（缺失则置 null），保持 map 良构。
      const target = action.sessionId
      const activeTabIdBySession = state.activeTabIdBySession[target] === undefined
        ? { ...state.activeTabIdBySession, [target]: null }
        : state.activeTabIdBySession
      return { ...state, activeSessionId: target, activeTabIdBySession }
    }
    case 'ADD_MESSAGE': {
      // 把消息追加到指定会话（不可变）。会话不存在则原样返回。
      const projects = state.projects.map(p => ({
        ...p,
        sessions: p.sessions.map(s =>
          s.id === action.sessionId
            ? { ...s, messages: [...s.messages, action.message] }
            : s
        )
      }))
      return { ...state, projects }
    }
    case 'OPEN_FILE_TAB': {
      const activeSessionId = state.activeSessionId
      const tabs = state.tabsBySession[activeSessionId] ?? []
      // 去重：同文件已开则切过去
      const existing = tabs.find(t => t.type === 'file' && t.filePath === action.filePath)
      if (existing) {
        return {
          ...state,
          activeTabIdBySession: { ...state.activeTabIdBySession, [activeSessionId]: existing.id }
        }
      }
      const newTab: Tab = {
        id: nextId('t'),
        type: 'file',
        title: action.fileName,
        filePath: action.filePath
      }
      return {
        ...state,
        tabsBySession: { ...state.tabsBySession, [activeSessionId]: [...tabs, newTab] },
        activeTabIdBySession: { ...state.activeTabIdBySession, [activeSessionId]: newTab.id }
      }
    }
    case 'OPEN_TAB': {
      const activeSessionId = state.activeSessionId
      const tabs = state.tabsBySession[activeSessionId] ?? []
      const newTab: Tab = {
        id: nextId('t'),
        type: action.tabType,
        title: action.tabType === 'browser' ? '浏览器' : action.tabType === 'terminal' ? '终端' : '文件'
      }
      return {
        ...state,
        tabsBySession: { ...state.tabsBySession, [activeSessionId]: [...tabs, newTab] },
        activeTabIdBySession: { ...state.activeTabIdBySession, [activeSessionId]: newTab.id }
      }
    }
    case 'CLOSE_TAB': {
      const activeSessionId = state.activeSessionId
      const tabs = (state.tabsBySession[activeSessionId] ?? []).filter(t => t.id !== action.tabId)
      const activeTabIdBySession = { ...state.activeTabIdBySession }
      const currentActive = activeTabIdOf(state)
      if (currentActive === action.tabId) {
        activeTabIdBySession[activeSessionId] = tabs.length > 0 ? tabs[tabs.length - 1].id : null
      }
      return {
        ...state,
        tabsBySession: { ...state.tabsBySession, [activeSessionId]: tabs },
        activeTabIdBySession
      }
    }
    case 'SELECT_TAB': {
      const activeSessionId = state.activeSessionId
      return {
        ...state,
        activeTabIdBySession: { ...state.activeTabIdBySession, [activeSessionId]: action.tabId }
      }
    }
    case 'SET_THEME': {
      return { ...state, theme: action.theme }
    }
    case 'SET_DRAFT_TEXT': {
      return { ...state, draft: { ...state.draft, text: action.text } }
    }
    case 'SET_DRAFT_ATTACHMENT': {
      return { ...state, draft: { ...state.draft, attachment: action.attachment } }
    }
    case 'CLEAR_DRAFT_ATTACHMENT': {
      const { attachment: _attachment, ...rest } = state.draft
      return { ...state, draft: rest }
    }
    case 'SEND_MESSAGE': {
      const { text, attachment } = state.draft
      // 文本和附件都为空则不发送
      if (!text.trim() && !attachment) return state
      const sessionId = state.activeSessionId
      const newMessage = {
        id: nextId('m'),
        role: 'user' as const,
        content: text,
        ...(attachment ? { attachment } : {})
      }
      const projects = state.projects.map(p => ({
        ...p,
        sessions: p.sessions.map(s =>
          s.id === sessionId
            ? { ...s, messages: [...s.messages, newMessage] }
            : s
        )
      }))
      // 发送后清空草稿
      return { ...state, projects, draft: { text: '' } }
    }
    default:
      return state
  }
}
