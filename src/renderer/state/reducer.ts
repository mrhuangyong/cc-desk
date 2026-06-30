import type { Action } from './actions'
import type { AppView, ContentBlock, Draft, Project, Session, SettingsSection, SystemNotice, Tab, ThemeId, AppSettings, UpdateStatus, ReviewState } from '../types'
import { serializeForPrompt } from '../editor/serialize'

// 上下文用量信息（来自 SDK getContextUsage control 命令）。
// totalTokens/maxTokens/percentage 是进度环主数据；categories 是 tooltip 明细。
export interface ContextUsageInfo {
  totalTokens: number
  maxTokens: number
  percentage: number
  categories?: { name: string; tokens: number; color?: string; isDeferred?: boolean }[]
}

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
    // 进行中 assistant message 在 projects.messages 中的 id（实时持久化锚点）。
    // 流式内容同步写入该 message，刷新后 HYDRATE 可恢复到截断点。
    draftMessageId?: string
  }>
  // 应用设置：apiKey / model / cwd / providers / models（与主进程 AppSettings 一致）
  settings: AppSettings
  // 本地会话 ID → Claude SDK 返回的真实 session ID 映射，用于 resume 续接
  claudeSessionMap: Record<string, string>
  // 待处理的用户对话请求（AskUserQuestion 等），Task 10 使用
  pendingDialog: { reqId: string; sessionId?: string; dialogKind: string; payload: any; toolUseId?: string } | null
  // 脏 tab 记录：key = tabId，value = true（未保存改动）。FileTab 上报，TabBar 读取消耗。
  dirtyTabIds: Record<string, boolean>
  // 用户点击文件树打开文件的递增计数：每次 OPEN_FILE_TAB +1。App 监听它，
  // 检测到文件被点击时自动展开折叠的右栏。切 tab/关 tab 不动它。
  lastFileOpenedSeq: number
  // 消息排队（queue 模式）：按会话隔离的待发送队列
  queueBySession: Record<string, import('../types').QueuedMessage[]>
  // Claude task：按会话隔离的 task 列表（悬浮面板）
  tasksBySession: Record<string, import('../types').TaskItem[]>
  // 后台任务：按会话隔离的后台任务列表（悬浮面板）
  backendTasksBySession: Record<string, import('../types').BackendTask[]>
  // 右上角悬浮任务面板：根级折叠态（重设计后不再有分区独立折叠）
  panelFold: { root: boolean }
  // 悬浮面板拖动位置（内存态；开启记忆时由 settings.panelPosition 覆盖）
  panelPosition: { x: number; y: number }
  // 子代理对话输出：按会话 + 触发它的 Task tool_use id 索引，累积 ContentBlock[]
  subagentOutputBySession: Record<string, Record<string, import('../types').ContentBlock[]>>
  // 计划模式：模型提交的计划（ExitPlanMode）。按会话隔离，每次提交覆盖前一条。
  planBySession: Record<string, import('../types').PlanProposal | null>
  // 用户主动中止的 session 标志:interrupt 可能不立即生效,SDK 续推的 delta 会被忽略,
  // 直到用户发新消息(STREAM_START)清除。避免停止后 streaming 被重建(停止按钮闪烁)。
  abortedBySession: Record<string, boolean>
  // 上下文用量（SDK getContextUsage）：按会话分片，供输入框进度环展示。
  // null/缺失表示尚未查询或会话不存在该数据。
  contextUsageBySession: Record<string, ContextUsageInfo | null>
  // /goal: 会话级目标条件。Stop hook 每轮评估,未满足续轮、满足清除。
  goalBySession: Record<string, import('../types').GoalState>
  // /goal 状态卡片开关:记录当前展开 GoalCard 的会话 id(全局单例,切换会话自动不匹配)。
  // GoalIndicator 点击 dispatch SHOW_GOAL_STATUS 置位;GoalCard 关闭/清除 dispatch HIDE_GOAL_CARD 清空。
  goalCardOpen: string | null
  // 就地编辑：当前正在编辑的消息 id（最后一条用户消息编辑重发）
  editingMessageId: string | null
  // 队列编辑：当前正在编辑的排队消息 id
  editingQueueId: string | null
  // 应用更新状态机（全局单例）。TitleBar / 应用菜单 / 关于页共享。
  updateStatus: UpdateStatus
  // 审查 tab：按项目分片的 git 改动状态
  reviewByProject: Record<string, ReviewState>
}

// TODO: idCounter is module-level mutable state — non-deterministic IDs. Acceptable for prototype; thread through state if persistence/time-travel needed later.
let idCounter = 0
function nextId(prefix: string): string {
  idCounter += 1
  return `${prefix}${idCounter}`
}

// 审查 tab：单个项目的 review 状态默认值（reducer 各 REVIEW_* 分支首次 upsert 时使用）
function emptyReview(): ReviewState {
  return {
    status: [], selectedPath: null, diffCache: {}, diffScope: 'HEAD',
    loadingStatus: false, loadingDiffPath: null, error: null,
    commitMessage: '', commitBusy: false,
    notice: null,
  }
}

// 按会话隔离的列表 upsert：tasksBySession / backendTasksBySession 共用。
function upsertBySession<S extends AppState, K extends keyof S>(
  state: S, field: K, sessionId: string, item: { id: string },
): S {
  const map = state[field] as unknown as Record<string, { id: string }[]>
  const list = map[sessionId] ?? []
  const idx = list.findIndex(t => t.id === item.id)
  const next = idx >= 0 ? list.map(t => (t.id === item.id ? item : t)) : [...list, item]
  return { ...state, [field]: { ...map, [sessionId]: next } }
}

// 按 sessionId 在 projects 树里更新单个会话：fn 接收旧 session 返回新 session。
// 覆盖所有「改某个会话字段」的场景：fn 内可读旧值算新值（如 messages 追加、extraDirs 追加），
// 这是 patchSession（浅 patch）做不到的。fn 返回同一对象引用表示无变化 → 原样返回 state（避免无谓新引用）。
function updateSession(state: AppState, sessionId: string, fn: (s: Session) => Session): AppState {
  let changed = false
  const projects = state.projects.map(p => ({
    ...p,
    sessions: p.sessions.map(s => {
      if (s.id !== sessionId) return s
      const next = fn(s)
      if (next === s) return s
      changed = true
      return next
    }),
  }))
  return changed ? { ...state, projects } : state
}

// 把系统 notice 附着到会话「当前可见的渲染点」：优先最近一条助手消息的 m.notices
// （Notices 组件渲染处）；若没有助手消息（如刚发起、尚无回复），退回到 streaming.notices
// （流式中的 Notices 渲染处）。两处都用已有的 <Notices> 渲染通道，无需新增渲染点。
// SHOW_COST(/cost /status /resume) 与 COMPACT_DONE(/compact) 走此通道——原先它们写
// session.notices，但该字段从不渲染，用户看不到反馈。
function attachNotice(state: AppState, sessionId: string, notice: SystemNotice): AppState {
  // 从后往前找最近一条助手消息
  let attached = false
  const next = updateSession(state, sessionId, s => {
    for (let i = s.messages.length - 1; i >= 0; i--) {
      if (s.messages[i].role === 'assistant') {
        const msgs = [...s.messages]
        msgs[i] = { ...msgs[i], notices: [...(msgs[i].notices ?? []), notice] }
        attached = true
        return { ...s, messages: msgs }
      }
    }
    return s
  })
  if (attached) return next
  // 无助手消息：退回到 streaming.notices（若有进行中的流）
  const stream = state.streamingBySession[sessionId]
  if (stream) {
    return { ...state, streamingBySession: { ...state.streamingBySession, [sessionId]: { ...stream, notices: [...stream.notices, notice] } } }
  }
  // 既无助手消息也无流：丢弃（极端竞态，无处可附）
  return state
}

// 按 sessionId 在 projects 树里浅 patch 单个会话字段（permission/thinking/messages 整体替换 等共用）。
// 需基于旧值计算的（如 messages 追加、extraDirs 追加、notices 追加）请直接用 updateSession。
function patchSession<S extends Session>(state: AppState, sessionId: string, patch: Partial<S>): AppState {
  return updateSession(state, sessionId, s => ({ ...s, ...patch }))
}

// 把 streaming blocks 同步写入 projects.messages 中 draftMessageId 对应的进行中 message。
// 实时持久化锚点:刷新后 HYDRATE 可恢复到截断点,新事件续接。
// 兜底:若 streaming 没有 draftMessageId(刷新后第一个事件先于 RESTORE_STREAMING 到达),
// 懒创建一个 draft message 并关联回去。
function syncDraftMessage(state: AppState, sessionId: string): AppState {
  let stream = state.streamingBySession[sessionId]
  if (!stream) return state
  // 无 draftMessageId:懒创建(竞态兜底)
  if (!stream.draftMessageId) {
    const draftId = `m${Date.now()}`
    const draftMsg = { id: draftId, role: 'assistant' as const, content: [{ type: 'text' as const, text: '' }] }
    const seeded = state.projects.map(p => ({
      ...p,
      sessions: p.sessions.map(s => s.id === sessionId ? { ...s, messages: [...s.messages, draftMsg] } : s),
    }))
    state = { ...state, projects: seeded, streamingBySession: { ...state.streamingBySession, [sessionId]: { ...stream, draftMessageId: draftId } } }
    stream = state.streamingBySession[sessionId]!
  }
  const draftId = stream.draftMessageId!
  const projects = state.projects.map(p => ({
    ...p,
    sessions: p.sessions.map(s => {
      if (s.id !== sessionId) return s
      const idx = s.messages.findIndex(m => m.id === draftId)
      if (idx < 0) return s
      const msgs = [...s.messages]
      msgs[idx] = {
        ...msgs[idx],
        content: stream!.blocks.length ? stream!.blocks : [{ type: 'text' as const, text: '' }],
        ...(stream!.notices.length ? { notices: stream!.notices } : {}),
      }
      return { ...s, messages: msgs, updatedAt: Date.now() }
    }),
  }))
  return { ...state, projects }
}

// 持久化恢复（HYDRATE）时，把 idCounter 重置为已恢复数据中的最大序号，// 持久化恢复（HYDRATE）时，把 idCounter 重置为已恢复数据中的最大序号，
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
    const found = p.sessions.find(s => s.id !== excludedId && !s.archived)
    if (found) return found.id
  }
  return null
}

// 反查 session 属于哪个 project（归档前 state 上找原属项目，用于补建新会话定位）
function findProjectIdBySessionId(projects: Project[], sessionId: string): string | null {
  for (const p of projects) {
    if (p.sessions.some(s => s.id === sessionId)) return p.id
  }
  return null
}

// 全局无存活（未归档）会话时，在指定 project 下补建一个空会话并设为 active，
// 让对话区进入「新会话」状态，而非空占位 / 残留已归档会话的旧内容。
// 返回 null 表示无需补建（全局已有存活会话，或连 project 都没有）。
function ensureAliveSession(
  projects: Project[],
  fallbackProjectId: string | null,
  tabsBySession: Record<string, Tab[]>,
  activeTabIdBySession: Record<string, string | null>,
): { projects: Project[]; activeSessionId: string; tabsBySession: Record<string, Tab[]>; activeTabIdBySession: Record<string, string | null> } | null {
  // 全局还有存活会话 → 不补建
  if (pickSurvivingSessionId(projects, '') !== null) return null
  // 选定补建的 project：优先 fallbackProjectId，否则第一个 project
  const targetProject = (fallbackProjectId && projects.find(p => p.id === fallbackProjectId)) || projects[0]
  if (!targetProject) return null
  const newSession: Session = { id: nextId('s'), title: '新会话', messages: [], updatedAt: Date.now() }
  const newProjects = projects.map(p =>
    p.id === targetProject.id ? { ...p, sessions: [...p.sessions, newSession] } : p
  )
  return {
    projects: newProjects,
    activeSessionId: newSession.id,
    tabsBySession: { ...tabsBySession, [newSession.id]: [] },
    activeTabIdBySession: { ...activeTabIdBySession, [newSession.id]: null },
  }
}

function sendDraftMessage(state: AppState, doc: Draft['doc'], attachments: Draft['attachments']): AppState {
  const prompt = serializeForPrompt(doc)
  // 文本和附件都为空则不发送
  if (!prompt.trim() && attachments.length === 0) return state
  const sessionId = state.activeSessionId
  // 用户附加的图片：转成 image content block，让用户气泡显示自己发的图，
  // 同时也随消息进入持久化。source 为纯 base64，ImageBlock 渲染时自动加 data: 前缀。
  const imageBlocks = attachments
    .filter(a => a.type === 'image')
    .map(a => ({ type: 'image' as const, source: a.base64 }))
  const content: ContentBlock[] = [
    ...(prompt ? [{ type: 'text' as const, text: prompt }] : []),
    ...imageBlocks,
  ]
  // 无文本也无图片时不该走到这（上面已拦截），兜底防 content 为空
  const newMessage = {
    id: nextId('m'),
    role: 'user' as const,
    content: content.length > 0 ? content : [{ type: 'text' as const, text: prompt }],
    ...(attachments.length ? { attachments } : {}),
  }
  // 首条消息标题：用 prompt 文本生成
  const makeTitle = (raw: string) => {
    const clean = raw.replace(/\s+/g, ' ').trim()
    return clean.length > 30 ? clean.slice(0, 30) + '…' : clean
  }
  const projects = updateSession(state, sessionId, s => {
    const isFirst = s.messages.length === 0
    return {
      ...s,
      messages: [...s.messages, newMessage],
      lastUserSentAt: Date.now(),
      ...(isFirst && s.title === '新会话' && prompt.trim() ? { title: makeTitle(prompt) } : {}),
    }
  }).projects
  return { ...state, projects, draft: { doc: null, attachments: [] } }
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
      // 若删的不是当前激活会话，不动 active
      if (state.activeSessionId !== action.sessionId) {
        return { ...state, projects }
      }
      // 删的是激活会话：优先切到另一个存活会话
      const surviving = pickSurvivingSessionId(projects, action.sessionId)
      if (surviving) return { ...state, projects, activeSessionId: surviving }
      // 全局无存活会话：在被删会话原属 project 下补建新会话，进入新会话状态
      const ensured = ensureAliveSession(projects, action.projectId, state.tabsBySession, state.activeTabIdBySession)
      if (ensured) return { ...state, ...ensured }
      return { ...state, projects, activeSessionId: state.activeSessionId }
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
      // 把消息追加到指定会话（不可变）。会话不存在则原样返回（updateSession 内部短路）。
      return updateSession(state, action.sessionId, s => ({
        ...s,
        messages: [...s.messages, action.message],
        updatedAt: Date.now(),
      }))
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
        title: action.tabType === 'browser' ? (action.url || '浏览器') : action.tabType === 'terminal' ? '终端' : action.tabType === 'review' ? '审查' : '文件',
        ...(action.cwd ? { cwd: action.cwd } : {}),
        ...(action.url ? { url: action.url } : {})
      }
      return {
        ...state,
        tabsBySession: { ...state.tabsBySession, [activeSessionId]: [...tabs, newTab] },
        activeTabIdBySession: { ...state.activeTabIdBySession, [activeSessionId]: newTab.id },
        lastFileOpenedSeq: state.lastFileOpenedSeq + 1
      }
    }
    case 'UPDATE_TAB_URL': {
      let changed = false
      const tabsBySession = Object.fromEntries(Object.entries(state.tabsBySession).map(([sessionId, tabs]) => {
        const nextTabs = tabs.map(tab => {
          if (tab.id !== action.tabId || tab.type !== 'browser') return tab
          if (tab.url === action.url && tab.title === action.url) return tab
          changed = true
          return { ...tab, url: action.url, title: action.url }
        })
        return [sessionId, nextTabs]
      }))
      return changed ? { ...state, tabsBySession } : state
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
    case 'SET_CONTEXT_USAGE': {
      // usage 为 null 时也写入（表示查询失败/未知态），覆盖旧值
      return { ...state, contextUsageBySession: { ...state.contextUsageBySession, [action.sessionId]: action.usage } }
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
      return sendDraftMessage(state, state.draft.doc, state.draft.attachments)
    }
    case 'SEND_MESSAGE_WITH_DRAFT': {
      return sendDraftMessage(state, action.doc, action.attachments)
    }
    case 'REMOTE_USER_MESSAGE': {
      // 远程（手机）发来的 user 文本，直接追加到目标会话。与本地 SEND_MESSAGE 不同：
      // 不走 draft、不切换 activeSessionId（桌面可能正看别的会话），只把这条 user
      // 消息塞进指定 session，让桌面端对话里除了 AI 回复也能看到「手机问的问题」。
      // 目标会话不存在时静默（HYDRATE 竞态窗口内可能先于会话节点到达），由后续
      // STREAM_ASSISTANT_BLOCKS / HYDRATE 校正，不抛错。
      //
      // 去重：本 action 有三个来源——① REMOTE_USER_MESSAGE 补丁(dispatcher 收到 session.message)
      // ② claude:user-message(SDK user turn 回放,可靠落盘源) ③ 本地 SEND_MESSAGE 也会加 user。
      // 同一条用户输入可能被多源触发,按「该 session 末条消息已是相同文本的 user」去重,避免重复。
      const existed = updateSession(state, action.sessionId, s => s).projects
      const sess = existed.flatMap(p => p.sessions).find(s => s.id === action.sessionId)
      const last = sess?.messages?.[sess.messages.length - 1]
      const lastText = last?.role === 'user' ? (last as any).content?.map((b: any) => b.text ?? '').join('') : undefined
      if (lastText !== undefined && lastText === action.text) {
        return state // 末条已是相同 user 文本,跳过(去重)
      }
      const newMessage = {
        id: nextId('m'),
        role: 'user' as const,
        content: [{ type: 'text' as const, text: action.text }],
      }
      const projects = updateSession(state, action.sessionId, s => ({
        ...s,
        messages: [...s.messages, newMessage],
        lastUserSentAt: Date.now(),
      })).projects
      return { ...state, projects }
    }
    case 'SET_VIEW': {
      return { ...state, currentView: action.view }
    }
    case 'SET_SETTINGS_SECTION': {
      // 切换子页并同时进入设置视图（保证从任何入口点技能/设置都进设置页）
      return { ...state, activeSettingsSection: action.section, currentView: 'settings' }
    }
    case 'STREAM_START': {
      // 创建进行中 assistant message 并放入 projects.messages,作为实时持久化锚点。
      // 流式 blocks 会同步写入它,刷新后 HYDRATE 恢复到截断点。
      const draftId = `m${Date.now()}`
      const draftMsg = { id: draftId, role: 'assistant' as const, content: [{ type: 'text' as const, text: '' }] }
      const projects = updateSession(state, action.sessionId, s => ({
        ...s,
        messages: [...s.messages, draftMsg],
        updatedAt: Date.now(),
      })).projects
      // 清除中止标志:用户发新消息表示开始新一轮,不再忽略 delta
      const { [action.sessionId]: _ab, ...restAb } = state.abortedBySession
      return {
        ...state,
        projects,
        streamingBySession: {
          ...state.streamingBySession,
          [action.sessionId]: { blocks: [], notices: [], draftMessageId: draftId },
        },
        abortedBySession: restAb,
      }
    }
    case 'STREAM_DELTA': {
      // 用户已中止该 session:interrupt 可能不立即生效,SDK 续推的 delta 被忽略
      if (state.abortedBySession[action.sessionId]) return state
      const prev = state.streamingBySession[action.sessionId] || { blocks: [], notices: [] }
      const blocks = [...prev.blocks]
      const last = blocks[blocks.length - 1]
      const blockType = action.kind === 'text' ? 'text' : 'thinking'
      if (last && last.type === blockType) {
        blocks[blocks.length - 1] = { ...last, text: (last as any).text + action.delta }
      } else {
        blocks.push({ type: blockType, text: action.delta } as ContentBlock)
      }
      const next = { ...state, streamingBySession: { ...state.streamingBySession, [action.sessionId]: { ...prev, blocks } } }
      return syncDraftMessage(next, action.sessionId)
    }
    case 'STREAM_TOOL_USE_START': {
      if (state.abortedBySession[action.sessionId]) return state
      const prev = state.streamingBySession[action.sessionId] || { blocks: [], notices: [] }
      const next = { ...state, streamingBySession: { ...state.streamingBySession, [action.sessionId]: { ...prev, blocks: [...prev.blocks, action.block] } } }
      return syncDraftMessage(next, action.sessionId)
    }
    case 'STREAM_TOOL_RESULT': {
      if (state.abortedBySession[action.sessionId]) return state
      const prev = state.streamingBySession[action.sessionId] || { blocks: [], notices: [] }
      const blocks = prev.blocks.map(b =>
        b.type === 'tool_use' && b.id === action.toolUseId
          ? {
              ...b, result: action.result,
              // ExitPlanMode 的 tool_result 是 SDK 退出 plan 模式时回填的占位结果
              // （is_error: true, "Exit plan mode?"），不代表计划失败——用户授权后必经此路。
              // 视作完成，避免卡片显示 error 红点误导用户以为计划失败。
              status: action.result.isError && (b as any).name !== 'ExitPlanMode' ? 'error' as const : 'completed' as const,
              ...(action.planFilePath ? { planFilePath: action.planFilePath } : {}),
            }
          : b
      )
      const next = { ...state, streamingBySession: { ...state.streamingBySession, [action.sessionId]: { ...prev, blocks } } }
      return syncDraftMessage(next, action.sessionId)
    }
    case 'STREAM_NOTICE': {
      const prev = state.streamingBySession[action.sessionId] || { blocks: [], notices: [] }
      const next = { ...state, streamingBySession: { ...state.streamingBySession, [action.sessionId]: { ...prev, notices: [...prev.notices, action.notice] } } }
      return syncDraftMessage(next, action.sessionId)
    }
    case 'STREAM_ERROR': {
      const prev = state.streamingBySession[action.sessionId] || { blocks: [], notices: [] }
      return {
        ...state,
        streamingBySession: { ...state.streamingBySession, [action.sessionId]: { ...prev, error: action.error } },
      }
    }
    case 'STREAM_ASSISTANT_BLOCKS': {
      if (state.abortedBySession[action.sessionId]) return state
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
      // 空 blocks 守卫：当本轮 assistant 内容全是被过滤的 tool_use
      // （AskUserQuestion/ExitPlanMode/TodoWrite/TaskCreate/TaskUpdate），
      // 或是 subagent 消息的空占位时，主进程会发来 blocks: []。
      // 此时不应丢弃末尾草稿块——否则主流已显示的文本会被清空，
      // 下一轮文字重新累积导致「消失/重现」闪烁。
      if (action.blocks.length === 0) {
        return syncDraftMessage(state, action.sessionId)
      }
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
            // 校正 input，但不降级已有的 status/result/planFilePath（review #3）
            const old = merged[idx] as any
            merged[idx] = { ...nb, input: nb.input ?? old.input, status: old.status !== 'running' ? old.status : nb.status, result: old.result, ...(old.planFilePath ? { planFilePath: old.planFilePath } : {}) } as ContentBlock
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
      const next = {
        ...state,
        streamingBySession: {
          ...state.streamingBySession,
          [action.sessionId]: { ...prev, blocks: merged, _seenUuids: [...(seen || []), action.uuid] } as any,
        },
      }
      return syncDraftMessage(next, action.sessionId)
    }
    case 'STREAM_END': {
      // 若该 session 没有进行中的流（竞态：未 STREAM_START 就收到 result，
      // 或已被 STREAM_ABORTED 清理），不追加幽灵空消息，仅原样返回。
      const existing = state.streamingBySession[action.sessionId]
      if (!existing) {
        // 即便没有 streaming(已被 aborted 清),也清除中止标志,允许后续新消息正常工作
        const { [action.sessionId]: _a, ...restA } = state.abortedBySession
        return { ...state, abortedBySession: restA }
      }
      const stream = existing
      // finalize draft message:补全 cost/turns 等,保留同一 id(不新建)。
      // 这样进行中内容已实时持久化,完成时只需补元数据。
      const projects = updateSession(state, action.sessionId, s => {
        // 有 draftMessageId 时 finalize 它;否则(老数据/竞态)回退到新建追加
        if (stream.draftMessageId) {
          const idx = s.messages.findIndex(m => m.id === stream.draftMessageId)
          if (idx >= 0) {
            const msgs = [...s.messages]
            msgs[idx] = {
              ...msgs[idx],
              content: stream.blocks.length ? stream.blocks : [{ type: 'text' as const, text: '' }],
              ...(stream.notices.length ? { notices: stream.notices } : {}),
              ...(action.costUSD != null ? { costUSD: action.costUSD } : {}),
              ...(action.durationMs != null ? { durationMs: action.durationMs } : {}),
              ...(action.turns != null ? { turns: action.turns } : {}),
              ...(action.isError ? { isError: true } : {}),
            }
            return { ...s, messages: msgs }
          }
        }
        const fallback = {
          id: `m${Date.now()}`, role: 'assistant' as const,
          content: stream.blocks.length ? stream.blocks : [{ type: 'text' as const, text: '' }],
          ...(stream.notices.length ? { notices: stream.notices } : {}),
          ...(action.costUSD != null ? { costUSD: action.costUSD } : {}),
          ...(action.durationMs != null ? { durationMs: action.durationMs } : {}),
          ...(action.turns != null ? { turns: action.turns } : {}),
          ...(action.isError ? { isError: true } : {}),
        }
        return { ...s, messages: [...s.messages, fallback] }
      }).projects
      // 防护：若该 session 有未答的 pendingDialog（授权等待期间 SDK 提前结束），
      // 保留 streaming 状态——用户回答后 SDK 会续跑，此时不应清流，避免按钮在
      // 「可发送/停止」间反复跳动。续跑的最终 result（无 pendingDialog 时）才真正清流。
      const dialogPending = state.pendingDialog?.sessionId === action.sessionId
      if (dialogPending) {
        // 固化本轮消息，但重置 streaming blocks 为空（续跑输出会重新追加）
        return { ...state, projects, streamingBySession: { ...state.streamingBySession, [action.sessionId]: { blocks: [], notices: [] } } }
      }
      const { [action.sessionId]: _, ...rest } = state.streamingBySession
      const { [action.sessionId]: _a2, ...restA2 } = state.abortedBySession
      return { ...state, projects, streamingBySession: rest, abortedBySession: restA2 }
    }
    case 'STREAM_ABORTED': {
      // draft message 已含已输出内容,保留在 messages 里(刷新后可见)。
      // 仅清理 streaming 状态。若 blocks 为空则移除空占位 message。
      const stream = state.streamingBySession[action.sessionId]
      let projects = state.projects
      if (stream?.draftMessageId) {
        // 若 draft 内容为空,移除占位;否则保留已输出内容（fn 内 idx<0 时原样返回 s）
        projects = updateSession(state, action.sessionId, s => {
          const idx = s.messages.findIndex(m => m.id === stream.draftMessageId)
          if (idx < 0) return s
          const draft = s.messages[idx]
          const isEmpty = draft.content.length === 0 || (draft.content.length === 1 && draft.content[0].type === 'text' && !(draft.content[0] as any).text)
          const msgs = isEmpty ? s.messages.filter(m => m.id !== stream.draftMessageId) : s.messages
          return { ...s, messages: msgs }
        }).projects
      }
      const { [action.sessionId]: _, ...rest } = state.streamingBySession
      // 标记该 session 已中止:interrupt 不立即生效时,SDK 续推的 delta 会被忽略,
      // 直到用户发新消息(STREAM_START 清除)。避免停止后 streaming 被重建。
      return { ...state, projects, streamingBySession: rest, abortedBySession: { ...state.abortedBySession, [action.sessionId]: true } }
    }
    case 'RESTORE_STREAMING': {
      // 刷新后:把已恢复的 draft message 重建为 streaming 状态。
      // blocks/notices 来自该 message 的 content,draftMessageId 关联回去。
      // 续推的 STREAM_DELTA 会追加到同一 draft,实现无缝恢复。
      return {
        ...state,
        streamingBySession: {
          ...state.streamingBySession,
          [action.sessionId]: {
            blocks: action.blocks,
            notices: action.notices,
            draftMessageId: action.draftMessageId,
          },
        },
      }
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
      // 收集所有 session id（含归档），用于清理孤儿 tab（指向已不存在 session）
      const aliveSessionIds = new Set(s.projects.flatMap(p => p.sessions.map(sess => sess.id)))
      const tabsBySession = Object.fromEntries(
        Object.entries(s.tabsBySession).filter(([k]) => aliveSessionIds.has(k))
      )
      const activeTabIdBySession = Object.fromEntries(
        Object.entries(s.activeTabIdBySession).filter(([k]) => aliveSessionIds.has(k))
      )
      // 优先沿用快照 active（若仍是未归档存活会话）；否则任意存活会话；都没有则留空，下面补建。
      // 注意：必须排除已归档会话，否则 active 落到归档会话上会让对话区残留旧内容。
      const liveSessionIds = new Set(s.projects.flatMap(p => p.sessions.filter(sess => !sess.archived).map(sess => sess.id)))
      const survivingActive = (s.activeSessionId && liveSessionIds.has(s.activeSessionId) ? s.activeSessionId : null)
        ?? pickSurvivingSessionId(s.projects, '')
      // 竞态修复：HYDRATE 用磁盘快照整体替换 projects，但内存里可能有比快照更新的消息
      // （远程 user 消息刚 dispatch 进内存、renderer 防抖 save 尚未落盘时，远程新建/归档会话
      // 触发 workspace:changed → HYDRATE 用旧快照覆盖 → user 消息丢失，表现为「桌面只看到
      // claude 回复、看不到手机发的消息」）。
      // 策略：按 sessionId 建内存 messages 索引，HYDRATE 时若内存该 session 的消息更多（更新），
      // 保留内存 messages，仅用快照同步其余字段（标题/归档态/会话列表等）。
      const memMessagesBySession = new Map<string, import('../types').Message[]>()
      for (const p of state.projects) {
        for (const sess of p.sessions) {
          if (sess.messages?.length) memMessagesBySession.set(sess.id, sess.messages)
        }
      }
      const mergedProjects = s.projects.map(p => ({
        ...p,
        sessions: p.sessions.map(sess => {
          const mem = memMessagesBySession.get(sess.id)
          // 内存版本更长 → 内存更新，保留内存 messages（避免覆盖远程刚加的 user 消息）
          if (mem && mem.length > (sess.messages?.length ?? 0)) {
            return { ...sess, messages: mem }
          }
          return sess
        }),
      }))
      const base: AppState = {
        ...state,
        projects: mergedProjects,
        activeSessionId: survivingActive ?? '',
        tabsBySession,
        activeTabIdBySession,
        claudeSessionMap: s.claudeSessionMap,
        // 保留 theme/currentView/settings/draft/streaming 等其余字段
      }
      // 快照里没有任何存活会话（全新用户 / 会话全归档）→ 补建空会话到第一个 project，
      // 让启动后对话区直接是新会话状态，而非「无选中会话」空占位。
      if (!survivingActive) {
        const ensured = ensureAliveSession(mergedProjects, null, state.tabsBySession, state.activeTabIdBySession)
        if (ensured) return { ...base, ...ensured }
      }
      return base
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
      return { ...state, pendingDialog: { reqId: action.reqId, sessionId: action.sessionId, dialogKind: action.dialogKind, payload: action.payload, toolUseId: action.toolUseId } }
    }
    case 'ANSWER_DIALOG': {
      return { ...state, pendingDialog: null }
    }
    case 'DIALOG_RESOLVED': {
      // 仅当当前 pendingDialog 是这个 reqId 时才清（避免清掉更新的 dialog）。
      // 不匹配则忽略。
      if (state.pendingDialog?.reqId === action.reqId) {
        return { ...state, pendingDialog: null }
      }
      return state
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
    case 'SET_EDITING_MESSAGE': {
      return { ...state, editingMessageId: action.messageId }
    }
    case 'SET_EDITING_QUEUE': {
      return { ...state, editingQueueId: action.queueId }
    }
    case 'UPDATE_QUEUED_MESSAGE': {
      const q = state.queueBySession[action.sessionId] ?? []
      return {
        ...state,
        queueBySession: {
          ...state.queueBySession,
          [action.sessionId]: q.map(m => m.id === action.queueId ? { ...m, prompt: action.prompt } : m),
        },
      }
    }
    case 'EDIT_RESEND': {
      // 截断：删除 messageId 及其之后的所有消息，用 newPrompt 替换该用户消息内容
      const projects = updateSession(state, action.sessionId, s => {
        const idx = s.messages.findIndex(m => m.id === action.messageId)
        if (idx === -1) return s
        const replaced = {
          ...s.messages[idx],
          content: [{ type: 'text' as const, text: action.newPrompt }],
        }
        return { ...s, messages: [...s.messages.slice(0, idx), replaced] }
      }).projects
      return { ...state, projects, editingMessageId: null }
    }
    case 'UPSERT_TASK': {
      return upsertBySession(state, 'tasksBySession', action.sessionId, action.task)
    }
    case 'SET_TASKS': {
      // TodoWrite 全量替换任务列表：每次调用都是完整的当前 todo 集合
      return { ...state, tasksBySession: { ...state.tasksBySession, [action.sessionId]: action.tasks } }
    }
    case 'CLEAR_TASKS': {
      return { ...state, tasksBySession: { ...state.tasksBySession, [action.sessionId]: [] } }
    }
    case 'CLEAR_FINISHED_TASKS': {
      // 手动清除已结束任务（completed/failed/killed），保留 running/pending/paused
      const list = state.tasksBySession[action.sessionId] ?? []
      const kept = list.filter(t => t.status === 'running' || t.status === 'pending' || t.status === 'paused')
      return { ...state, tasksBySession: { ...state.tasksBySession, [action.sessionId]: kept } }
    }
    case 'KILL_RUNNING_TASKS': {
      // 停止 claude 时：把该会话所有未结束（pending/running）的 TaskItem 置为 killed。
      // 主进程 interrupt() 不持有 tasksBySession，故由渲染端在 onAborted 时补齐。
      const list = state.tasksBySession[action.sessionId] ?? []
      return { ...state, tasksBySession: { ...state.tasksBySession, [action.sessionId]:
        list.map(t => (t.status === 'running' || t.status === 'pending') ? { ...t, status: 'killed' } : t) } }
    }
    case 'UPSERT_BACKEND_TASK': {
      return upsertBySession(state, 'backendTasksBySession', action.sessionId, action.task)
    }
    case 'CLEAR_BACKEND_TASKS': {
      return { ...state, backendTasksBySession: { ...state.backendTasksBySession, [action.sessionId]: [] } }
    }
    case 'REMOVE_BACKEND_TASK': {
      const list = state.backendTasksBySession[action.sessionId] ?? []
      return { ...state, backendTasksBySession: { ...state.backendTasksBySession, [action.sessionId]: list.filter(t => t.id !== action.taskId) } }
    }
    case 'CLEAR_FINISHED_BACKEND_TASKS': {
      const list = state.backendTasksBySession[action.sessionId] ?? []
      return { ...state, backendTasksBySession: { ...state.backendTasksBySession, [action.sessionId]: list.filter(t => t.status === 'running') } }
    }
    case 'ARCHIVE_SESSION': {
      const projects = updateSession(state, action.sessionId, s => ({
        ...s,
        archived: true,
        archivedAt: Date.now(),
      })).projects
      // 归档的不是当前激活会话，不动 active
      if (state.activeSessionId !== action.sessionId) {
        return { ...state, projects }
      }
      // 归档的是激活会话：优先切到另一个存活会话（跨 project 也可切）
      const surviving = pickSurvivingSessionId(projects, action.sessionId)
      if (surviving) return { ...state, projects, activeSessionId: surviving }
      // 全局无存活会话：在被归档会话原属 project 下补建新会话，避免对话区残留旧内容
      const archivedProjectId = findProjectIdBySessionId(state.projects, action.sessionId)
      const ensured = ensureAliveSession(projects, archivedProjectId, state.tabsBySession, state.activeTabIdBySession)
      if (ensured) return { ...state, ...ensured }
      return { ...state, projects, activeSessionId: state.activeSessionId }
    }
    case 'RESTORE_SESSION': {
      const projects = updateSession(state, action.sessionId, s => ({
        ...s,
        archived: false,
        archivedAt: undefined,
      })).projects
      return { ...state, projects }
    }
    case 'MOVE_SESSION': {
      // 把会话从当前所属项目移到目标项目。仅在会话为空(无消息)时允许——
      // 参考 Codex:新建空会话可修改关联项目,已有对话的会话锁定归属。
      const srcProject = state.projects.find(p => p.sessions.some(s => s.id === action.sessionId))
      if (!srcProject) return state
      const target = srcProject.sessions.find(s => s.id === action.sessionId)
      if (!target) return state
      const projects = state.projects.map(p =>
        p.id === srcProject.id
          ? { ...p, sessions: p.sessions.filter(s => s.id !== action.sessionId) }
          : p.id === action.toProjectId
            ? { ...p, sessions: [...p.sessions, target] }
            : p
      )
      return { ...state, projects }
    }
    case 'APPEND_SUBAGENT_OUTPUT': {
      const bySession = state.subagentOutputBySession[action.sessionId] ?? {}
      const existing = bySession[action.toolUseId] ?? []
      let merged: import('../types').ContentBlock[]
      const blk = action.block
      if (blk.type === 'tool_result') {
        // 工具结果回填到已存在的 tool_use（匹配 toolUseId），让抽屉里的工具卡显示结果。
        // 与主流 STREAM_TOOL_RESULT 的合并逻辑一致。
        merged = existing.map(b =>
          b.type === 'tool_use' && b.id === blk.toolUseId
            ? { ...b, result: { content: blk.content, isError: blk.isError }, status: blk.isError ? 'error' as const : 'completed' as const }
            : b
        )
      } else {
        merged = [...existing, blk]
      }
      return {
        ...state,
        subagentOutputBySession: {
          ...state.subagentOutputBySession,
          [action.sessionId]: {
            ...bySession,
            [action.toolUseId]: merged,
          },
        },
      }
    }
    case 'SET_PANEL_FOLD': {
      return { ...state, panelFold: { root: action.folded } }
    }
    case 'SET_PANEL_POSITION': {
      return { ...state, panelPosition: action.position }
    }
    case 'SHOW_PLAN': {
      return { ...state, planBySession: { ...state.planBySession, [action.sessionId]: action.plan } }
    }
    case 'DISMISS_PLAN': {
      return { ...state, planBySession: { ...state.planBySession, [action.sessionId]: null } }
    }
    case 'CLEAR_SESSION_MESSAGES': {
      // /clear 联动:开新会话清空时顺带清 goal(官方:/clear 清 goal)
      const { [action.sessionId]: _goal, ...goalRest } = state.goalBySession
      return { ...patchSession(state, action.sessionId, { messages: [] }), goalBySession: goalRest }
    }
    case 'SET_SESSION_PERMISSION': {
      return patchSession(state, action.sessionId, { permissionMode: action.permissionMode })
    }
    case 'SET_SESSION_THINKING': {
      return patchSession(state, action.sessionId, { thinking: action.thinking })
    }
    case 'ADD_SESSION_DIR': {
      // 依赖当前 extraDirs 追加：updateSession 的 fn 接收旧 session，正适合这种「读旧值算新值」。
      const projects = updateSession(state, action.sessionId, s => ({
        ...s,
        extraDirs: [...(s.extraDirs ?? []), action.dir],
      })).projects
      return { ...state, projects }
    }
    case 'SHOW_COST': {
      // text 空 → 聚合本会话 costUSD/turns；非空（/status /resume 的模型/cwd/提示）直接用
      let text = action.text
      const session = state.projects.find(p => p.sessions.some(s => s.id === action.sessionId))?.sessions.find(s => s.id === action.sessionId)
      if (!text && session) {
        const total = session.messages.reduce((sum, m) => sum + (m.costUSD ?? 0), 0)
        const turns = session.messages.reduce((sum, m) => sum + (m.turns ?? 0), 0)
        text = total > 0 ? `本会话累计：$${total.toFixed(4)} / ${turns} turns` : '暂无费用统计'
      }
      const notice: SystemNotice = { id: `n${Date.now()}`, kind: 'status', text: text || '暂无费用统计', level: 'info' }
      return attachNotice(state, action.sessionId, notice)
    }
    case 'COMPACT_DONE': {
      const notice: SystemNotice = { id: `n${Date.now()}`, kind: 'compact', text: action.summary, level: 'info' }
      // 先截断消息，再把 compact 摘要 notice 附着到（截断后）最近一条助手消息
      const truncated = updateSession(state, action.sessionId, s => ({
        ...s,
        messages: s.messages.slice(-action.keepRecent),
      }))
      return attachNotice(truncated, action.sessionId, notice)
    }
    case 'UPDATE_STATUS': {
      return { ...state, updateStatus: action.status }
    }
    case 'REVIEW_SET_STATUS': {
      const prev = state.reviewByProject[action.projectId] ?? emptyReview()
      return { ...state, reviewByProject: { ...state.reviewByProject, [action.projectId]: { ...prev, status: action.status } } }
    }
    case 'REVIEW_SELECT_FILE': {
      const prev = state.reviewByProject[action.projectId] ?? emptyReview()
      return { ...state, reviewByProject: { ...state.reviewByProject, [action.projectId]: { ...prev, selectedPath: action.path } } }
    }
    case 'REVIEW_SET_DIFF': {
      const prev = state.reviewByProject[action.projectId] ?? emptyReview()
      return { ...state, reviewByProject: { ...state.reviewByProject, [action.projectId]: { ...prev, diffCache: { ...prev.diffCache, [action.path]: action.diff } } } }
    }
    case 'REVIEW_SET_DIFF_SCOPE': {
      const prev = state.reviewByProject[action.projectId] ?? emptyReview()
      return { ...state, reviewByProject: { ...state.reviewByProject, [action.projectId]: { ...prev, diffScope: action.scope } } }
    }
    case 'REVIEW_SET_LOADING': {
      const prev = state.reviewByProject[action.projectId] ?? emptyReview()
      return { ...state, reviewByProject: { ...state.reviewByProject, [action.projectId]: { ...prev, ...action.loading } } }
    }
    case 'REVIEW_SET_ERROR': {
      const prev = state.reviewByProject[action.projectId] ?? emptyReview()
      return { ...state, reviewByProject: { ...state.reviewByProject, [action.projectId]: { ...prev, error: action.error } } }
    }
    case 'REVIEW_SET_COMMIT_MESSAGE': {
      const prev = state.reviewByProject[action.projectId] ?? emptyReview()
      return { ...state, reviewByProject: { ...state.reviewByProject, [action.projectId]: { ...prev, commitMessage: action.message } } }
    }
    case 'REVIEW_SET_NOTICE': {
      const prev = state.reviewByProject[action.projectId] ?? emptyReview()
      return { ...state, reviewByProject: { ...state.reviewByProject, [action.projectId]: { ...prev, notice: action.notice } } }
    }
    case 'REVIEW_CLEAR_DIFF_CACHE': {
      const prev = state.reviewByProject[action.projectId] ?? emptyReview()
      return { ...state, reviewByProject: { ...state.reviewByProject, [action.projectId]: { ...prev, diffCache: {} } } }
    }
    case 'REVIEW_CLEAR': {
      const { [action.projectId]: _gone, ...rest } = state.reviewByProject
      return { ...state, reviewByProject: rest }
    }
    case 'SET_GOAL': {
      const goal = {
        condition: action.condition.slice(0, 4000),  // 官方 4000 字符上限
        startedAt: Date.now(),
        turns: 0,
        tokensBaseline: 0,
        lastReason: '',
        status: 'active' as const,
      }
      return { ...state, goalBySession: { ...state.goalBySession, [action.sessionId]: goal } }
    }
    case 'GOAL_EVALUATED': {
      const prev = state.goalBySession[action.sessionId]
      if (!prev) return state
      return {
        ...state,
        goalBySession: {
          ...state.goalBySession,
          [action.sessionId]: { ...prev, turns: action.turns, lastReason: action.reason },
        },
      }
    }
    case 'GOAL_ACHIEVED': {
      const prev = state.goalBySession[action.sessionId]
      if (!prev) return state
      return {
        ...state,
        goalBySession: {
          ...state.goalBySession,
          [action.sessionId]: { ...prev, status: 'achieved' as const },
        },
      }
    }
    case 'CLEAR_GOAL': {
      const { [action.sessionId]: _g, ...rest } = state.goalBySession
      return { ...state, goalBySession: rest }
    }
    case 'SHOW_GOAL_STATUS': {
      // 打开目标会话的 GoalCard。GoalIndicator 点击触发,跨组件(InputBar 命令分支)也能打开。
      return { ...state, goalCardOpen: action.sessionId }
    }
    case 'HIDE_GOAL_CARD': {
      return { ...state, goalCardOpen: null }
    }
    default:
      return state
  }
}
