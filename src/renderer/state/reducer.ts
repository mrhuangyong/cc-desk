import type { Action } from './actions'
import type { AppView, ContentBlock, Draft, Project, Session, SettingsSection, SystemNotice, Tab, ThemeId, AppSettings } from '../types'
import { serializeForPrompt } from '../editor/serialize'

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
  // 流式输出：按会话隔离的流式状态（blocks 为流式拼接的内容块）
  streamingBySession: Record<string, {
    blocks: ContentBlock[]
    notices: SystemNotice[]
    error?: string
  }>
  // 应用设置：apiKey / model / cwd / providers / models（与主进程 AppSettings 一致）
  settings: AppSettings
  // 本地会话 ID → Claude SDK 返回的真实 session ID 映射，用于 resume 续接
  claudeSessionMap: Record<string, string>
  // 待处理的用户对话请求（AskUserQuestion 等），Task 10 使用
  pendingDialog: { reqId: string; dialogKind: string; payload: any; toolUseId?: string } | null
  // 脏 tab 记录：key = tabId，value = true（未保存改动）。FileTab 上报，TabBar 读取消耗。
  dirtyTabIds: Record<string, boolean>
  // 用户点击文件树打开文件的递增计数：每次 OPEN_FILE_TAB +1。App 监听它，
  // 检测到文件被点击时自动展开折叠的右栏。切 tab/关 tab 不动它。
  lastFileOpenedSeq: number
  // 消息排队（queue 模式）：按会话隔离的待发送队列
  queueBySession: Record<string, import('../types').QueuedMessage[]>
  // Claude task：按会话隔离的 task 列表（悬浮面板）
  tasksBySession: Record<string, import('../types').TaskItem[]>
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
          activeTabIdBySession: { ...state.activeTabIdBySession, [activeSessionId]: existing.id },
          lastFileOpenedSeq: state.lastFileOpenedSeq + 1
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
        activeTabIdBySession: { ...state.activeTabIdBySession, [activeSessionId]: newTab.id },
        lastFileOpenedSeq: state.lastFileOpenedSeq + 1
      }
    }
    case 'OPEN_TAB': {
      const activeSessionId = state.activeSessionId
      const tabs = state.tabsBySession[activeSessionId] ?? []
      const newTab: Tab = {
        id: nextId('t'),
        type: action.tabType,
        title: action.tabType === 'browser' ? '浏览器' : action.tabType === 'terminal' ? '终端' : action.tabType === 'review' ? '审查' : '文件',
        ...(action.cwd ? { cwd: action.cwd } : {})
      }
      return {
        ...state,
        tabsBySession: { ...state.tabsBySession, [activeSessionId]: [...tabs, newTab] },
        activeTabIdBySession: { ...state.activeTabIdBySession, [activeSessionId]: newTab.id }
      }
    }
    case 'TAB_DIRTY': {
      const dirtyTabIds = { ...state.dirtyTabIds }
      if (action.dirty) dirtyTabIds[action.tabId] = true
      else delete dirtyTabIds[action.tabId]
      return { ...state, dirtyTabIds }
    }
    case 'CLOSE_TAB': {
      const activeSessionId = state.activeSessionId
      const tabs = (state.tabsBySession[activeSessionId] ?? []).filter(t => t.id !== action.tabId)
      const activeTabIdBySession = { ...state.activeTabIdBySession }
      const currentActive = activeTabIdOf(state)
      if (currentActive === action.tabId) {
        activeTabIdBySession[activeSessionId] = tabs.length > 0 ? tabs[tabs.length - 1].id : null
      }
      const dirtyTabIds = { ...state.dirtyTabIds }
      delete dirtyTabIds[action.tabId]
      return {
        ...state,
        tabsBySession: { ...state.tabsBySession, [activeSessionId]: tabs },
        activeTabIdBySession,
        dirtyTabIds
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
    case 'SET_DRAFT_DOC': {
      return { ...state, draft: { ...state.draft, doc: action.doc } }
    }
    case 'ADD_DRAFT_ATTACHMENT': {
      return { ...state, draft: { ...state.draft, attachments: [...state.draft.attachments, action.attachment] } }
    }
    case 'REMOVE_DRAFT_ATTACHMENT': {
      return { ...state, draft: { ...state.draft, attachments: state.draft.attachments.filter((_, i) => i !== action.index) } }
    }
    case 'CLEAR_DRAFT': {
      return { ...state, draft: { doc: null, attachments: [] } }
    }
    case 'SEND_MESSAGE': {
      const { doc, attachments } = state.draft
      const prompt = serializeForPrompt(doc)
      // 文本和附件都为空则不发送
      if (!prompt.trim() && attachments.length === 0) return state
      const sessionId = state.activeSessionId
      const newMessage = {
        id: nextId('m'),
        role: 'user' as const,
        content: [{ type: 'text' as const, text: prompt }],
        ...(attachments.length ? { attachments } : {}),
      }
      // 首条消息标题：用 prompt 文本生成
      const makeTitle = (raw: string) => {
        const clean = raw.replace(/\s+/g, ' ').trim()
        return clean.length > 30 ? clean.slice(0, 30) + '…' : clean
      }
      const projects = state.projects.map(p => ({
        ...p,
        sessions: p.sessions.map(s => {
          if (s.id !== sessionId) return s
          const isFirst = s.messages.length === 0
          return {
            ...s,
            messages: [...s.messages, newMessage],
            ...(isFirst && s.title === '新会话' && prompt.trim() ? { title: makeTitle(prompt) } : {}),
          }
        }),
      }))
      return { ...state, projects, draft: { doc: null, attachments: [] } }
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
          [action.sessionId]: { blocks: [], notices: [] },
        },
      }
    }
    case 'STREAM_DELTA': {
      const prev = state.streamingBySession[action.sessionId] || { blocks: [], notices: [] }
      const blocks = [...prev.blocks]
      const last = blocks[blocks.length - 1]
      const blockType = action.kind === 'text' ? 'text' : 'thinking'
      if (last && last.type === blockType) {
        blocks[blocks.length - 1] = { ...last, text: (last as any).text + action.delta }
      } else {
        blocks.push({ type: blockType, text: action.delta } as ContentBlock)
      }
      return {
        ...state,
        streamingBySession: {
          ...state.streamingBySession,
          [action.sessionId]: { ...prev, blocks },
        },
      }
    }
    case 'STREAM_TOOL_USE_START': {
      const prev = state.streamingBySession[action.sessionId] || { blocks: [], notices: [] }
      return {
        ...state,
        streamingBySession: {
          ...state.streamingBySession,
          [action.sessionId]: { ...prev, blocks: [...prev.blocks, action.block] },
        },
      }
    }
    case 'STREAM_TOOL_RESULT': {
      const prev = state.streamingBySession[action.sessionId] || { blocks: [], notices: [] }
      const blocks = prev.blocks.map(b =>
        b.type === 'tool_use' && b.id === action.toolUseId
          ? { ...b, result: action.result, status: action.result.isError ? 'error' as const : 'completed' as const }
          : b
      )
      return {
        ...state,
        streamingBySession: { ...state.streamingBySession, [action.sessionId]: { ...prev, blocks } },
      }
    }
    case 'STREAM_NOTICE': {
      const prev = state.streamingBySession[action.sessionId] || { blocks: [], notices: [] }
      return {
        ...state,
        streamingBySession: {
          ...state.streamingBySession,
          [action.sessionId]: { ...prev, notices: [...prev.notices, action.notice] },
        },
      }
    }
    case 'STREAM_ERROR': {
      const prev = state.streamingBySession[action.sessionId] || { blocks: [], notices: [] }
      return {
        ...state,
        streamingBySession: { ...state.streamingBySession, [action.sessionId]: { ...prev, error: action.error } },
      }
    }
    case 'STREAM_ASSISTANT_BLOCKS': {
      const prev = state.streamingBySession[action.sessionId] || { blocks: [], notices: [] }
      const seen = (prev as any)._seenUuids as string[] | undefined
      if (seen?.includes(action.uuid)) {
        return state
      }
      // assistant 完整消息是本轮输出的权威版本，用于校正流式临时态。
      // 关键：流式 text_delta 已拼出同一段文本，校正时不能直接 push 否则重复。
      // 策略：流式期间末尾连续的 text/thinking block 视为本轮草稿，用 assistant
      // 的对应内容替换；tool_use 按 id 合并（保留已回填的 result/status）。
      const merged = [...prev.blocks]
      // 1) 丢弃末尾连续的纯文本/思考草稿块（它们将由 assistant 的 text/thinking 取代）
      while (merged.length) {
        const t = merged[merged.length - 1].type
        if (t === 'text' || t === 'thinking') merged.pop()
        else break
      }
      // 2) 合入 assistant 的 blocks
      for (const nb of action.blocks) {
        if (nb.type === 'tool_use') {
          const idx = merged.findIndex(b => b.type === 'tool_use' && b.id === nb.id)
          if (idx >= 0) {
            // 校正 input，但不降级已有的 status/result（review #3）
            const old = merged[idx] as any
            merged[idx] = { ...nb, input: nb.input ?? old.input, status: old.status !== 'running' ? old.status : nb.status, result: old.result } as ContentBlock
          } else {
            merged.push(nb)
          }
        } else if (nb.type === 'text' || nb.type === 'thinking') {
          // 与流式残留的同类块合并去重：若末尾已是同类型，则替换（同一段文本的权威版）
          const last = merged[merged.length - 1]
          if (last && last.type === nb.type) merged[merged.length - 1] = nb
          else merged.push(nb)
        } else {
          merged.push(nb)
        }
      }
      return {
        ...state,
        streamingBySession: {
          ...state.streamingBySession,
          [action.sessionId]: { ...prev, blocks: merged, _seenUuids: [...(seen || []), action.uuid] } as any,
        },
      }
    }
    case 'STREAM_END': {
      // 若该 session 没有进行中的流（竞态：未 STREAM_START 就收到 result，
      // 或已被 STREAM_ABORTED 清理），不追加幽灵空消息，仅原样返回。
      const existing = state.streamingBySession[action.sessionId]
      if (!existing) return state
      const stream = existing
      const assistantMsg = {
        id: `m${Date.now()}`,
        role: 'assistant' as const,
        content: stream.blocks.length ? stream.blocks : [{ type: 'text' as const, text: '' }],
        ...(stream.notices.length ? { notices: stream.notices } : {}),
        ...(action.costUSD != null ? { costUSD: action.costUSD } : {}),
        ...(action.durationMs != null ? { durationMs: action.durationMs } : {}),
        ...(action.turns != null ? { turns: action.turns } : {}),
        ...(action.isError ? { isError: true } : {}),
      }
      const projects = state.projects.map(p => ({
        ...p,
        sessions: p.sessions.map(s => s.id === action.sessionId ? { ...s, messages: [...s.messages, assistantMsg] } : s),
      }))
      const { [action.sessionId]: _, ...rest } = state.streamingBySession
      return { ...state, projects, streamingBySession: rest }
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
    case 'SHOW_DIALOG': {
      return { ...state, pendingDialog: { reqId: action.reqId, dialogKind: action.dialogKind, payload: action.payload, toolUseId: action.toolUseId } }
    }
    case 'ANSWER_DIALOG': {
      return { ...state, pendingDialog: null }
    }
    case 'ENQUEUE_MESSAGE': {
      const q = state.queueBySession[action.sessionId] ?? []
      const item: import('../types').QueuedMessage = {
        id: nextId('q'), prompt: action.prompt, attachments: action.attachments,
      }
      return { ...state, queueBySession: { ...state.queueBySession, [action.sessionId]: [...q, item] } }
    }
    case 'DEQUEUE_MESSAGE': {
      const q = state.queueBySession[action.sessionId] ?? []
      return { ...state, queueBySession: { ...state.queueBySession, [action.sessionId]: q.filter(m => m.id !== action.queueId) } }
    }
    case 'CLEAR_QUEUE': {
      return { ...state, queueBySession: { ...state.queueBySession, [action.sessionId]: [] } }
    }
    case 'UPSERT_TASK': {
      const list = state.tasksBySession[action.sessionId] ?? []
      const idx = list.findIndex(t => t.id === action.task.id)
      const next = idx >= 0
        ? list.map(t => t.id === action.task.id ? action.task : t)
        : [...list, action.task]
      return { ...state, tasksBySession: { ...state.tasksBySession, [action.sessionId]: next } }
    }
    case 'CLEAR_TASKS': {
      return { ...state, tasksBySession: { ...state.tasksBySession, [action.sessionId]: [] } }
    }
    default:
      return state
  }
}
