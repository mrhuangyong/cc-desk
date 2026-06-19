// window.api 类型声明 —— 由 preload 的 contextBridge 暴露。
// 渲染进程通过 window.api.claude / .settings / .fs / .pty 调用主进程。

import type { AppSettings } from './types'
import type { Project, Tab, ModelProvider, ModelItem } from './types'
import type {
  ClaudeMcpServer, ClaudePlugin, ClaudeSkill, ClaudeCommand, ClaudeHook,
  ModelConfig, GeneralConfig,
} from '../main/claude-config'

interface ClaudeAPI {
  send(opts: { prompt: string; localSessionId?: string; sessionId?: string; cwd?: string; permission?: string; thinking?: 'low' | 'medium' | 'high'; extraDirs?: string[] }): Promise<void>
  stop(localSessionId: string): Promise<void>
  onSystem(cb: (data: { sessionId: string; model: string; tools: string[] }) => void): void
  onDelta(cb: (data: { kind: 'text' | 'thinking'; delta: string }) => void): void
  onBlocks(cb: (data: any) => void): void
  onNotice(cb: (data: any) => void): void
  onTask(cb: (data: any) => void): void
  onResult(cb: (data: { sessionId: string; subtype: string; isError: boolean; costUSD: number; durationMs: number; turns: number }) => void): void
  onError(cb: (data: { error: string }) => void): void
  onAborted(cb: (data: any) => void): void
  onDialogRequest(cb: (data: any) => void): void
  onBuiltinResult(cb: (data: any) => void): void
  onPlan(cb: (data: any) => void): void
  dialogResponse(payload: { reqId: string; result: any }): Promise<void>
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
}

interface ProjectsAPI {
  get(): Promise<ProjectsSnapshot & { lastSeq: number; savedAt: number }>
  save(snap: ProjectsSnapshot): Promise<void>
}

interface FsAPI {
  readTree(dirPath: string): Promise<any[]>
  readFile(filePath: string): Promise<string>
  writeFile(filePath: string, content: string): Promise<void>
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

// Claude 真实配置（读写 ~/.claude/）
interface ClaudeConfigAPI {
  mcp: {
    get(): Promise<ClaudeMcpServer[]>
    save(servers: ClaudeMcpServer[]): Promise<void>
  }
  plugins: {
    get(): Promise<ClaudePlugin[]>
    setEnabled(id: string, enabled: boolean): Promise<void>
  }
  skills: { get(): Promise<ClaudeSkill[]> }
  commands: { get(): Promise<ClaudeCommand[]> }
  hooks: {
    get(): Promise<ClaudeHook[]>
    setEnabled(name: string, enabled: boolean): Promise<void>
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
      pty: PtyAPI
      backendTask: BackendTaskAPI
      session: SessionAPI
      dialog: DialogAPI
      cc: ClaudeConfigAPI
      onArchiveTick: MiscAPI['onArchiveTick']
    }
  }
}

export {}
