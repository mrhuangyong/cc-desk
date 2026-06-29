import { createContext, useContext, useMemo, useSyncExternalStore, useRef, type ReactNode } from 'react'
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

// === 外部 store（模块级）：useSyncExternalStore 的标准外部 store 模式 ===
// state 持有从 React 内部 useReducer 移到模块级，reducer 函数零改动。
// 这样 useSelector 可分片订阅（未订阅切片变化不重渲），useStore 兼容入口行为不变。
const listeners = new Set<() => void>()
let curState: AppState = makeInitialState()

function getState(): AppState {
  return curState
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}
// dispatch：跑 reducer + 同步通知订阅者。模块级函数，引用永远稳定。
// 替换原 useReducer 返回的 dispatch；所有现有 dispatch 调用点拿的是 useStore().dispatch，
// 指向这个函数，签名同为 (action: Action) => void，零影响。
function dispatchAction(action: Action): void {
  curState = reducer(curState, action)
  listeners.forEach(l => l())
}

// 测试隔离用：模块级 curState 跨用例共享，测试前重置回干净初态。
export function resetStore(initialState?: AppState): void {
  curState = initialState ?? makeInitialState()
  listeners.forEach(l => l())
}

export interface StoreContextValue {
  state: AppState
  dispatch: typeof dispatchAction
}
const StoreContext = createContext<StoreContextValue | null>(null)

// initialProjects 仅用于测试同步播种；生产环境会话由 Claude 通过 INIT_SESSIONS 注入。
// 每个 AppProvider 挂载时重置模块级 curState——这与原 useReducer 惰性初始化「每次 mount
// 用 makeInitialState(initialProjects) 生成全新 state」语义一致：无 initialProjects 时回到空态，
// 有时按 seed 播种。这保证多个测试各自 mount AppProvider 时互不串台。
// 生产环境单一 AppProvider 挂载一次，state 后续由 INIT_SESSIONS/HYDRATE 等动作注入并持久累积。
export function AppProvider({ children, initialProjects }: { children: ReactNode; initialProjects?: Project[] }) {
  const seededRef = useRef(false)
  if (!seededRef.current) {
    curState = makeInitialState(initialProjects)
    listeners.forEach(l => l())
    seededRef.current = true
  }
  // 订阅模块级 state，Context 里的 state 自动跟随更新（useStore 取到的永远是最新）
  const state = useSyncExternalStore(subscribe, getState, getState)
  // 稳定化 context value：state 引用不变时复用旧 value，
  // 避免 useStore 消费者因 value 新对象而无差别重渲。dispatch 本就稳定（模块级）。
  const value = useMemo(() => ({ state, dispatch: dispatchAction }), [state])
  return (
    <StoreContext.Provider value={value}>
      {children}
    </StoreContext.Provider>
  )
}

// useSelector：分片订阅。getSnapshot 用 useRef 缓存 selector 结果（幂等，防无限循环）。
// useSyncExternalStore 要求 getSnapshot 幂等（同 state 多次调用返回同引用）；
// 返回对象的 selector 若每次新建引用 → React 判变 → 重取 → 又新引用 → 死循环，故必须缓存。
export function useSelector<T>(selector: (state: AppState) => T): T {
  const cacheRef = useRef<{ input: AppState; output: T } | undefined>(undefined)
  const getSnapshot = (): T => {
    const cur = curState
    if (cacheRef.current && cacheRef.current.input === cur) {
      return cacheRef.current.output
    }
    const next = selector(cur)
    cacheRef.current = { input: cur, output: next }
    return next
  }
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

// useDispatch：返回稳定的模块级 dispatch。
export function useDispatch(): typeof dispatchAction {
  return dispatchAction
}

// useStore：兼容入口（39 处现有消费点零改动）。
export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within AppProvider')
  return ctx
}
