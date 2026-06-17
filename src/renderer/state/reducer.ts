import type { Action } from './actions'
import type { AppView, Draft, Project, Session, SettingsSection, Tab, ThemeId, AppSettings } from '../types'

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
  currentView: AppView
  activeSettingsSection: SettingsSection
  // 流式输出：按会话隔离的流式状态（currentText 为增量拼接的临时文本）
  streamingBySession: Record<string, {
    isStreaming: boolean
    currentText: string
    thinking?: string        // 思考过程增量（showThinking 控制展示）
    tools?: { id: string; name: string }[]  // 本轮工具调用（showTodo 控制展示）
    error?: string
  }>
  // 应用设置：apiKey / model / cwd / providers / models（与主进程 AppSettings 一致）
  settings: AppSettings
  // 本地会话 ID → Claude SDK 返回的真实 session ID 映射，用于 resume 续接
  claudeSessionMap: Record<string, string>
}

// TODO: idCounter is module-level mutable state — non-deterministic IDs. Acceptable for prototype; thread through state if persistence/time-travel needed later.
let idCounter = 0
function nextId(prefix: string): string {
  idCounter += 1
  return `${prefix}${idCounter}`
}

// 持久化恢复（HYDRATE）时，把 idCounter 重置为已恢复数据中的最大序号，
// 避免新增 ID 与已恢复的 p1/p2/s1... 冲突。
export function setIdCounter(n: number): void {
  idCounter = n
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
    case 'ADD_PROJECT': {
      // 去重：已有同路径项目则不新增
      if (state.projects.some(p => p.path === action.path)) return state
      const newProject: Project = {
        id: nextId('p'),
        name: action.name,
        path: action.path,
        sessions: [],
      }
      const projects = [...state.projects, newProject]
      return { ...state, projects }
    }
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
      const newSession: Session = { id: nextId('s'), title: '新会话', messages: [], updatedAt: Date.now() }
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
            ? { ...s, messages: [...s.messages, action.message], updatedAt: Date.now() }
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
        title: action.tabType === 'browser' ? '浏览器' : action.tabType === 'terminal' ? '终端' : action.tabType === 'review' ? '审查' : '文件'
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
        content: [{ type: 'text' as const, text }],
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
    case 'SET_VIEW': {
      return { ...state, currentView: action.view }
    }
    case 'SET_SETTINGS_SECTION': {
      // 切换子页并同时进入设置视图（保证从任何入口点技能/设置都进设置页）
      return { ...state, activeSettingsSection: action.section, currentView: 'settings' }
    }
    case 'STREAM_START': {
      return {
        ...state,
        streamingBySession: {
          ...state.streamingBySession,
          [action.sessionId]: { isStreaming: true, currentText: '', thinking: '', tools: [] }
        }
      }
    }
    case 'STREAM_DELTA': {
      const prev = state.streamingBySession[action.sessionId]
      return {
        ...state,
        streamingBySession: {
          ...state.streamingBySession,
          [action.sessionId]: {
            ...prev,
            currentText: (prev?.currentText || '') + action.delta,
            isStreaming: true,
          }
        }
      }
    }
    case 'STREAM_THINKING': {
      const prev = state.streamingBySession[action.sessionId]
      return {
        ...state,
        streamingBySession: {
          ...state.streamingBySession,
          [action.sessionId]: {
            ...prev,
            thinking: (prev?.thinking || '') + action.delta,
            isStreaming: true,
          }
        }
      }
    }
    case 'STREAM_TOOL_USE': {
      const prev = state.streamingBySession[action.sessionId]
      return {
        ...state,
        streamingBySession: {
          ...state.streamingBySession,
          [action.sessionId]: {
            ...prev,
            tools: [...(prev?.tools || []), action.tool],
            isStreaming: true,
          }
        }
      }
    }
    case 'STREAM_END': {
      console.log('[cc-stream] [8] reducer STREAM_END', { sessionId: action.sessionId, hasEntry: !!state.streamingBySession[action.sessionId] })
      const { [action.sessionId]: _, ...rest } = state.streamingBySession
      const textBlocks = action.content.filter((b: any) => b.type === 'text')
      const projects = state.projects.map(p => ({
        ...p,
        sessions: p.sessions.map(s =>
          s.id === action.sessionId
            ? {
                ...s,
                messages: [...s.messages, {
                  id: `m${Date.now()}`,
                  role: 'assistant' as const,
                  content: textBlocks.length > 0
                    ? textBlocks.map((b: any) => ({ type: 'text' as const, text: b.text }))
                    : [{ type: 'text' as const, text: '' }],
                }],
              }
            : s
        )
      }))
      return { ...state, projects, streamingBySession: rest }
    }
    case 'STREAM_ERROR': {
      return {
        ...state,
        streamingBySession: {
          ...state.streamingBySession,
          [action.sessionId]: { isStreaming: false, currentText: '', error: action.error }
        }
      }
    }
    case 'STREAM_ABORTED': {
      const { [action.sessionId]: _, ...rest } = state.streamingBySession
      return { ...state, streamingBySession: rest }
    }
    case 'SET_SETTINGS': {
      return { ...state, settings: { ...state.settings, ...action.settings } }
    }
    case 'INIT_SESSIONS': {
      return { ...state, projects: action.projects }
    }
    case 'HYDRATE': {
      const s = action.snapshot
      // 重置 ID 计数器到已恢复的最大序号，避免后续新增 ID 冲突
      setIdCounter(s.lastSeq)
      // 收集所有存活 session id，用于清理孤儿 tab（指向已不存在 session）
      const aliveSessionIds = new Set(s.projects.flatMap(p => p.sessions.map(sess => sess.id)))
      const tabsBySession = Object.fromEntries(
        Object.entries(s.tabsBySession).filter(([k]) => aliveSessionIds.has(k))
      )
      const activeTabIdBySession = Object.fromEntries(
        Object.entries(s.activeTabIdBySession).filter(([k]) => aliveSessionIds.has(k))
      )
      const fallbackActive = s.activeSessionId && aliveSessionIds.has(s.activeSessionId)
        ? s.activeSessionId
        : (s.projects[0]?.sessions[0]?.id ?? '')
      return {
        ...state,
        projects: s.projects,
        activeSessionId: fallbackActive,
        tabsBySession,
        activeTabIdBySession,
        claudeSessionMap: s.claudeSessionMap,
        // 保留 theme/currentView/settings/draft/streaming 等其余字段
      }
    }
    case 'SET_CLAUDE_SESSION_ID': {
      return {
        ...state,
        claudeSessionMap: {
          ...state.claudeSessionMap,
          [action.localSessionId]: action.claudeSessionId,
        }
      }
    }
    case 'ARCHIVE_STALE': {
      // 归档：删除最后活动早于 beforeTs 且无消息的空会话（保留激活会话，避免清空）
      const active = state.activeSessionId
      const projects = state.projects.map(p => ({
        ...p,
        sessions: p.sessions.filter(s => {
          if (s.id === active) return true            // 永不归档当前激活会话
          if (s.messages.length > 0) return true       // 有消息的会话保留
          const ts = s.updatedAt ?? 0
          if (!ts) return true                          // 无时间戳的不动
          return ts >= action.beforeTs                  // 早于阈值且空 → 归档(删除)
        }),
      }))
      return { ...state, projects }
    }
    default:
      return state
  }
}
