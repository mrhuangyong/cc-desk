// window.api 类型声明 —— 由 preload 的 contextBridge 暴露。
// 渲染进程通过 window.api.claude / .settings / .fs / .pty 调用主进程。

import type { AppSettings, UpdateStatus } from './types'
import type { Project, Tab, ModelProvider, ModelItem, GitFileStatus, DiffScope } from './types'
import type {
  ClaudeMcpServer, ClaudePlugin, ClaudeSkill, ClaudeCommand,
  HookEntry, HookMatcher, HookEventView, HooksFull,
  ModelConfig, GeneralConfig,
} from '../main/claude-config'
import type {
  KnownMarketplace, PluginMarketplaceEntry, SearchResult,
} from '../main/marketplace-manager'

interface ClaudeAPI {
  send(opts: { prompt: string; localSessionId?: string; sessionId?: string; cwd?: string; permission?: string; thinking?: 'low' | 'medium' | 'high'; extraDirs?: string[]; images?: { mediaType: string; data: string; name?: string }[] }): Promise<void>
  stop(localSessionId: string): Promise<void>
  runningSessions(): Promise<string[]>
  onSystem(cb: (data: { sessionId: string; model: string; tools: string[] }) => void): void
  onDelta(cb: (data: { kind: 'text' | 'thinking'; delta: string }) => void): void
  onBlocks(cb: (data: any) => void): void
  onNotice(cb: (data: any) => void): void
  onTask(cb: (data: any) => void): void
  onResult(cb: (data: { sessionId: string; subtype: string; isError: boolean; costUSD: number; durationMs: number; turns: number }) => void): void
  onError(cb: (data: { error: string }) => void): void
  onAborted(cb: (data: any) => void): void
  onDialogRequest(cb: (data: any) => void): void
  // dialog 已被任一端解决：返回 unsubscribe，组件卸载时调用避免监听器累加。
  onDialogResolved(cb: (data: { reqId: string }) => void): () => void
  // 远程（手机）发来的 user 文本：返回 unsubscribe，组件卸载时调用避免监听器累加。
  onRemoteUserMessage(cb: (data: { localSessionId: string; text: string }) => void): () => void
  // SDK user turn 的纯文本（claude:user-message）：user 消息与 assistant 同源持久化。
  onUserMessage(cb: (data: { localSessionId: string; text: string }) => void): () => void
  onNotification(cb: (data: { localSessionId: string; text: string; priority: string }) => void): void
  onBuiltinResult(cb: (data: any) => void): void
  onSubagentOutput(cb: (data: any) => void): void
  dialogResponse(payload: { reqId: string; result: any }): Promise<void>
  // 刷新后拉取所有未决挂起 dialog，补回卡片（否则主进程 Promise 永久挂起、SDK 死锁）。
  pendingDialogs(): Promise<Array<{ reqId: string; localSessionId?: string; dialogKind: string; payload: any; toolUseId?: string }>>
  setPermissionMode(opts: { localSessionId: string; permission: string }): Promise<void>
  contextUsage(localSessionId: string): Promise<any>
  onContextUsage(cb: (data: any) => void): (() => void) | undefined
  // /goal: set/clear 同步主进程 goalStore;evaluated/achieved 下行通知。
  setGoal(lsid: string, condition: string): Promise<void>
  clearGoal(lsid: string): Promise<void>
  onGoalEvaluated(cb: (data: any) => void): void
  onGoalAchieved(cb: (data: any) => void): void
  onGoalSetByRemote(cb: (data: any) => void): void
  removeAllListeners(): void
}

interface SettingsAPI {
  get(): Promise<AppSettings>
  save(s: Partial<AppSettings>): Promise<void>
}

interface CcDeskModelAPI {
  get(): Promise<{
    providers: ModelProvider[]
    models: ModelItem[]
    modelRoleMap: Record<string, string>
    activeModelId: string
  }>
  save(patch: { providers?: ModelProvider[]; models?: ModelItem[]; modelRoleMap?: Record<string, string>; activeModelId?: string }): Promise<void>
  /** 模型配置变更(桌面/手机任一端切换)时订阅刷新。返回取消订阅函数。 */
  onChange(cb: () => void): () => void
}
interface CcDeskAPI {
  model: CcDeskModelAPI
}

// 工作区快照（projects 含会话/消息，独立 projects.json 存储）
interface ProjectsSnapshot {
  projects: Project[]
  activeSessionId: string
  tabsBySession: Record<string, Tab[]>
  activeTabIdBySession: Record<string, string | null>
  claudeSessionMap: Record<string, string>
  // /goal: 只持久化 active goal 的条件(achieved/cleared 不还原,官方)
  goalBySession?: Record<string, { condition: string }>
}

interface ProjectsAPI {
  get(): Promise<ProjectsSnapshot & { lastSeq: number; savedAt: number }>
  save(snap: ProjectsSnapshot): Promise<void>
  /** 远程控制改变了 projects.json，渲染端据此重新 HYDRATE 同步。返回 unsubscribe。 */
  onWorkspaceChanged(cb: () => void): () => void
}

interface FsAPI {
  readTree(dirPath: string): Promise<any[]>
  readFile(filePath: string): Promise<string>
  writeFile(filePath: string, content: string): Promise<void>
  searchFiles(dirPath: string): Promise<any[]>
  exists(filePath: string): Promise<boolean>
  statKind(filePath: string): Promise<'file' | 'dir' | 'absent'>
}

interface GitAPI {
  status(cwd: string): Promise<GitFileStatus[]>
  diff(cwd: string, scope: DiffScope, filePath?: string): Promise<string>
  add(cwd: string, paths: string[]): Promise<void>
  restore(cwd: string, paths: string[], staged: boolean): Promise<void>
  commit(cwd: string, message: string): Promise<{ sha: string }>
  resetHard(cwd: string): Promise<void>
  generateCommitMessage(cwd: string): Promise<string | null>
}

interface PtyAPI {
  create(opts: { tabId: string; cols: number; rows: number; cwd?: string }): Promise<void>
  input(opts: { tabId: string; data: string }): Promise<void>
  resize(opts: { tabId: string; cols: number; rows: number }): Promise<void>
  kill(tabId: string): Promise<void>
  onOutput(cb: (data: { tabId: string; data: string }) => void): void
  onExit(cb: (data: { tabId: string; code: number }) => void): void
}

interface BackendTaskAPI {
  list(localSessionId: string): Promise<any[]>
  kill(localSessionId: string, taskId: string): Promise<{ ok: boolean; error?: string }>
  // 从主进程 registry 删除任务记录（单个或批量），避免刷新后已移除任务复活。
  remove(localSessionId: string, taskIds: string | string[]): Promise<number>
  onEvent(cb: (data: any) => void): () => void
}

interface SessionAPI {
  archive(localSessionId: string): Promise<void>
}

interface DialogAPI {
  openDirectory(): Promise<string | null>
}

interface MiscAPI {
  onArchiveTick(cb: (data: { beforeTs: number }) => void): () => void
}

// 远程控制（设置页：开关/配对/解绑/状态）
interface RemoteAPI {
  getConfig(): Promise<{
    enabled: boolean
    relayUrl: string
    deviceId: string
    deviceKey: string
    pairedDevices: string[]
  }>
  saveConfig(patch: Partial<{
    enabled: boolean
    relayUrl: string
    pairedDevices: string[]
  }>): Promise<void>
  pair(): Promise<{ code?: string; qr?: string; expiresAt?: number; error?: string }>
  cancelPair(): Promise<{ ok: boolean }>
  unpair(deviceId: string): Promise<{ ok: boolean }>
  createShareLink(expiresInDays: number): Promise<{ token?: string; url?: string; qr?: string; expiresAt?: number; error?: string }>
  revokeShareLink(token: string): Promise<{ ok: boolean; error?: string }>
  onPairEvent(cb: (data: { kind: string; deviceId?: string }) => void): () => void
  onState(cb: (s: { connected: boolean }) => void): () => void
  removeAllListeners(): void
}

// Claude 配置（读写隔离目录 ~/.cc-desk/claude/）
interface ClaudeConfigAPI {
  mcp: {
    get(): Promise<ClaudeMcpServer[]>
    save(servers: ClaudeMcpServer[]): Promise<void>
    getJson(): Promise<string>
  }
  plugins: {
    get(): Promise<ClaudePlugin[]>
    setEnabled(id: string, enabled: boolean): Promise<void>
    install(pluginId: string): Promise<{ success: boolean; message: string }>
    uninstall(pluginId: string): Promise<{ success: boolean; message: string }>
  }
  marketplaces: {
    get(): Promise<KnownMarketplace[]>
    getPlugins(name: string): Promise<PluginMarketplaceEntry[]>
    search(query: string): Promise<SearchResult[]>
    add(source: string, options?: { type?: string; ref?: string; autoUpdate?: boolean }): Promise<{ name: string; alreadyExists: boolean }>
    remove(name: string): Promise<{ cascadedPlugins: string[] }>
    refresh(name: string): Promise<void>
    refreshAll(): Promise<void>
    setAutoUpdate(name: string, enabled: boolean): Promise<void>
  }
  skills: {
    get(): Promise<ClaudeSkill[]>
    getFile(id: string): Promise<string>
    saveFile(id: string, content: string): Promise<void>
    setEnabled(name: string, enabled: boolean): Promise<void>
  }
  commands: {
    get(): Promise<ClaudeCommand[]>
    create(name: string, description: string): Promise<{ success: boolean; message: string; command?: ClaudeCommand }>
    getFile(source: string, name: string): Promise<string>
    saveFile(name: string, content: string): Promise<void>
    delete(name: string): Promise<void>
  }
  hooks: {
    get(): Promise<HooksFull>
    save(hooks: Record<string, any>): Promise<{ success: boolean; errors: string[] }>
    getJson(): Promise<string>
    saveJson(jsonText: string): Promise<{ success: boolean; errors: string[] }>
  }
  memory: {
    get(): Promise<string>
    save(content: string): Promise<void>
  }
  model: {
    get(): Promise<ModelConfig>
    save(cfg: Partial<ModelConfig>): Promise<void>
  }
  general: {
    get(): Promise<GeneralConfig>
    save(cfg: Partial<GeneralConfig>): Promise<void>
  }
  builtin: {
    compact(localSessionId: string): Promise<void>
    init(opts: { cwd: string }): Promise<void>
    exportSession(localSessionId: string): Promise<void>
    addDir(opts: { localSessionId: string; dir: string }): Promise<void>
  }
}

// 本文件含 import（变成 module），需用 declare global 扩充 Window。
declare global {
  interface Window {
    api: {
      claude: ClaudeAPI
      settings: SettingsAPI
      ccDesk: CcDeskAPI,
      projects: ProjectsAPI
      fs: FsAPI
      git: GitAPI
      pty: PtyAPI
      backendTask: BackendTaskAPI
      session: SessionAPI
      dialog: DialogAPI
      cc: ClaudeConfigAPI
      onArchiveTick: MiscAPI['onArchiveTick']
      update: {
        onState: (cb: (s: UpdateStatus) => void) => () => void
        check: () => Promise<void>
        install: () => Promise<void>
        downloadAndOpen: () => Promise<void>
      }
      appVersion: {
        get: () => Promise<{ version: string; electron: string; chrome: string; node: string }>
      }
      setDevTools: (enabled: boolean) => Promise<void>
      remote: RemoteAPI
    }
  }
}

export {}
