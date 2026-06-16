// window.api 类型声明 —— 由 preload 的 contextBridge 暴露。
// 渲染进程通过 window.api.claude / .settings / .fs / .pty 调用主进程。

interface ClaudeAPI {
  send(opts: { prompt: string; sessionId?: string; cwd?: string }): Promise<void>
  stop(): Promise<void>
  onStreamDelta(cb: (data: { delta: string }) => void): void
  onSystem(cb: (data: { sessionId: string; model: string; tools: string[] }) => void): void
  onAssistant(cb: (data: { content: any[]; costUSD: number; durationMs: number }) => void): void
  onResult(
    cb: (data: { sessionId: string; subtype: string; costUSD: number; durationMs: number; turns: number }) => void
  ): void
  onError(cb: (data: { error: string }) => void): void
  onAborted(cb: () => void): void
  removeAllListeners(): void
}

interface SettingsAPI {
  get(): Promise<{ apiKey: string; model: string; cwd: string }>
  save(s: Partial<{ apiKey: string; model: string; cwd: string }>): Promise<void>
}

interface FsAPI {
  readTree(dirPath: string): Promise<any[]>
  readFile(filePath: string): Promise<string>
}

interface PtyAPI {
  create(opts: { tabId: string; cols: number; rows: number; cwd?: string }): Promise<void>
  input(opts: { tabId: string; data: string }): Promise<void>
  resize(opts: { tabId: string; cols: number; rows: number }): Promise<void>
  kill(tabId: string): Promise<void>
  onOutput(cb: (data: { tabId: string; data: string }) => void): void
  onExit(cb: (data: { tabId: string; code: number }) => void): void
}

interface DialogAPI {
  openDirectory(): Promise<string | null>
}

interface Window {
  api: {
    claude: ClaudeAPI
    settings: SettingsAPI
    fs: FsAPI
    pty: PtyAPI
    dialog: DialogAPI
  }
}
