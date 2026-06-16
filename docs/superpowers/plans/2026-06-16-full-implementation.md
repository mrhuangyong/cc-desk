# cc-desk 全量实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 cc-desk 从 UI 原型（mock 数据）升级为真实可用的 Claude Code 桌面客户端。

**Architecture:** 主进程通过 Claude Agent SDK 封装 Claude 交互，通过 IPC 桥接推送到渲染进程。渲染进程保持 React 状态管理，通过 contextBridge 调用主进程 API。

**Tech Stack:** Electron 42 + React 18 + TypeScript 6 + Claude Agent SDK + node-pty + xterm.js + electron-store

---

## 文件结构

```
src/main/
  index.ts              — 入口，注册所有 IPC handler
  claude-service.ts     — SDK 封装（query/abort/session）
  pty-manager.ts        — 终端进程管理
  file-service.ts       — 文件系统操作（目录树/文件读取）
  settings-store.ts     — electron-store 持久化设置

src/preload/
  index.ts              — contextBridge 暴露 API

src/renderer/
  types.ts              — 更新类型定义
  global.d.ts           — window.api 类型声明
  state/
    store.tsx           — 更新：接入真实数据
    reducer.ts          — 新增 streaming 相关 action
    actions.ts          — 新增 action 类型
  components/
    ChatArea.tsx         — 流式消息渲染 + 工具调用
    InputBar.tsx         — 通过 IPC 发送
    TerminalTab.tsx      — xterm.js 集成
    FileTree.tsx         — 真实文件系统
```

---

## Task 1: 安装依赖 + 主进程基础设施

**Files:**
- Modify: `package.json`
- Create: `src/main/claude-service.ts`
- Create: `src/main/settings-store.ts`
- Create: `src/main/file-service.ts`
- Create: `src/main/pty-manager.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: 安装依赖**

```bash
pnpm add @anthropic-ai/claude-agent-sdk electron-store
pnpm add -D @types/node
# node-pty 需要编译原生模块
pnpm add node-pty
# xterm.js 终端渲染
pnpm add @xterm/xterm @xterm/addon-fit
```

- [ ] **Step 2: 验证安装**

```bash
pnpm exec tsc --noEmit
```
Expected: 无错误（新包可能需要更新 tsconfig）

- [ ] **Step 3: Commit**

```bash
git commit -am "chore: 安装 SDK/node-pty/xterm/electron-store 依赖"
```

---

## Task 2: SettingsStore（设置持久化）

**Files:**
- Create: `src/main/settings-store.ts`

- [ ] **Step 1: 实现 SettingsStore**

```typescript
// src/main/settings-store.ts
import Store from 'electron-store'

export interface AppSettings {
  apiKey: string
  model: string
  cwd: string
}

const defaults: AppSettings = {
  apiKey: '',
  model: 'sonnet',
  cwd: process.env.HOME || '',
}

const store = new Store<{ settings: AppSettings }>({
  defaults: { settings: defaults },
  encryptionKey: 'cc-desk-settings',  // 加密存储
})

export function getSettings(): AppSettings {
  return store.get('settings', defaults)
}

export function saveSettings(partial: Partial<AppSettings>): void {
  const current = getSettings()
  store.set('settings', { ...current, ...partial })
}
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat: SettingsStore 持久化设置（electron-store）"
```

---

## Task 3: ClaudeService（SDK 封装）

**Files:**
- Create: `src/main/claude-service.ts`

- [ ] **Step 1: 实现 ClaudeService**

```typescript
// src/main/claude-service.ts
import { query, AbortError } from '@anthropic-ai/claude-agent-sdk'
import type { WebContents } from 'electron'
import { getSettings } from './settings-store'

export class ClaudeService {
  private abortController: AbortController | null = null

  async send(opts: {
    prompt: string
    sessionId?: string
    cwd?: string
    webContents: WebContents
  }): Promise<void> {
    const { prompt, sessionId, cwd, webContents } = opts
    const settings = getSettings()

    if (!settings.apiKey) {
      webContents.send('claude:error', { error: '请先在设置中配置 API Key' })
      return
    }

    this.abortController = new AbortController()

    try {
      const stream = query({
        prompt,
        options: {
          apiKey: settings.apiKey,
          model: settings.model,
          cwd: cwd || settings.cwd || process.cwd(),
          resume: sessionId,
          permissionMode: 'auto',
          maxTurns: 20,
          abortController: this.abortController,
          onTextDelta: (delta: string) => {
            webContents.send('claude:stream-delta', { delta })
          },
        }
      })

      for await (const message of stream) {
        switch (message.type) {
          case 'system':
            webContents.send('claude:system', {
              sessionId: message.session_id,
              model: message.model,
              tools: message.tools?.map((t: any) => t.name),
            })
            break

          case 'assistant':
            webContents.send('claude:assistant', {
              content: (message as any).message?.content || [],
              costUSD: (message as any).cost_usd,
              durationMs: (message as any).duration_ms,
            })
            break

          case 'result':
            webContents.send('claude:result', {
              sessionId: (message as any).session_id,
              subtype: (message as any).subtype,
              costUSD: (message as any).total_cost_usd,
              durationMs: (message as any).duration_ms,
              turns: (message as any).num_turns,
            })
            break
        }
      }
    } catch (err) {
      if (err instanceof AbortError) {
        webContents.send('claude:aborted')
      } else {
        webContents.send('claude:error', { error: String(err) })
      }
    } finally {
      this.abortController = null
    }
  }

  abort(): void {
    this.abortController?.abort()
  }
}
```

- [ ] **Step 2: 验证编译**

```bash
pnpm exec tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: ClaudeService SDK 封装（query/abort/流式推送）"
```

---

## Task 4: PtyManager + FileService

**Files:**
- Create: `src/main/pty-manager.ts`
- Create: `src/main/file-service.ts`

- [ ] **Step 1: 实现 PtyManager**

```typescript
// src/main/pty-manager.ts
import * as pty from 'node-pty'
import type { WebContents } from 'electron'

export class PtyManager {
  private processes = new Map<string, pty.IPty>()
  private webContents: WebContents | null = null

  setWebContents(wc: WebContents) { this.webContents = wc }

  create(tabId: string, cols: number, rows: number, cwd?: string): void {
    const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || 'bash')
    const p = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols, rows,
      cwd: cwd || process.env.HOME || '/',
    })
    p.onData((data: string) => {
      this.webContents?.send('pty:output', { tabId, data })
    })
    p.onExit(({ exitCode }: { exitCode: number }) => {
      this.processes.delete(tabId)
      this.webContents?.send('pty:exit', { tabId, code: exitCode })
    })
    this.processes.set(tabId, p)
  }

  write(tabId: string, data: string): void {
    this.processes.get(tabId)?.write(data)
  }

  resize(tabId: string, cols: number, rows: number): void {
    this.processes.get(tabId)?.resize(cols, rows)
  }

  kill(tabId: string): void {
    const p = this.processes.get(tabId)
    if (p) { p.kill(); this.processes.delete(tabId) }
  }

  killAll(): void {
    for (const [id, p] of this.processes) { p.kill() }
    this.processes.clear()
  }
}
```

- [ ] **Step 2: 实现 FileService**

```typescript
// src/main/file-service.ts
import { readdir, readFile, stat } from 'fs/promises'
import { join, extname } from 'path'

export interface FileNode {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
}

const IGNORE = new Set(['node_modules', '.git', '.next', 'dist', 'out', '.claude', '.vscode'])

export async function readDirTree(dirPath: string, depth = 3): Promise<FileNode[]> {
  if (depth <= 0) return []
  const entries = await readdir(dirPath, { withFileTypes: true })
  const nodes: FileNode[] = []
  for (const entry of entries) {
    if (IGNORE.has(entry.name)) continue
    const fullPath = join(dirPath, entry.name)
    if (entry.isDirectory()) {
      const children = await readDirTree(fullPath, depth - 1)
      nodes.push({ name: entry.name, path: fullPath, isDir: true, children })
    } else {
      nodes.push({ name: entry.name, path: fullPath, isDir: false })
    }
  }
  return nodes.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

export async function readFileContent(filePath: string): Promise<string> {
  const s = await stat(filePath)
  if (s.size > 1024 * 200) throw new Error('文件过大（>200KB）')
  return readFile(filePath, 'utf-8')
}
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: PtyManager (node-pty) + FileService (目录树/文件读取)"
```

---

## Task 5: IPC 通道 + Preload

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Create: `src/renderer/global.d.ts`

- [ ] **Step 1: 更新 main/index.ts 注册所有 IPC handler**

```typescript
// src/main/index.ts
import { app, BrowserWindow, shell, ipcMain } from 'electron'
import { join } from 'path'
import { ClaudeService } from './claude-service'
import { PtyManager } from './pty-manager'
import { readDirTree, readFileContent } from './file-service'
import { getSettings, saveSettings } from './settings-store'

const isDev = !app.isPackaged
const claude = new ClaudeService()
const ptyManager = new PtyManager()

function createWindow() {
  const win = new BrowserWindow({
    width: 1680, height: 1040, minWidth: 960, minHeight: 640,
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    trafficLightPosition: process.platform === 'darwin' ? { x: 12, y: 12 } : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
    }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  ptyManager.setWebContents(win.webContents)

  // === Claude IPC ===
  ipcMain.handle('claude:send', (_e, opts) => {
    claude.send({ ...opts, webContents: win.webContents })
  })
  ipcMain.handle('claude:stop', () => claude.abort())

  // === Settings IPC ===
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:save', (_e, partial) => saveSettings(partial))

  // === File System IPC ===
  ipcMain.handle('fs:read-tree', async (_e, dirPath: string) => {
    return readDirTree(dirPath)
  })
  ipcMain.handle('fs:read-file', async (_e, filePath: string) => {
    return readFileContent(filePath)
  })

  // === Terminal IPC ===
  ipcMain.handle('pty:create', (_e, opts) => {
    ptyManager.create(opts.tabId, opts.cols, opts.rows, opts.cwd)
  })
  ipcMain.handle('pty:input', (_e, opts) => ptyManager.write(opts.tabId, opts.data))
  ipcMain.handle('pty:resize', (_e, opts) => ptyManager.resize(opts.tabId, opts.cols, opts.rows))
  ipcMain.handle('pty:kill', (_e, tabId) => ptyManager.kill(tabId))
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  ptyManager.killAll()
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 2: 更新 preload/index.ts**

```typescript
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  claude: {
    send: (opts: any) => ipcRenderer.invoke('claude:send', opts),
    stop: () => ipcRenderer.invoke('claude:stop'),
    onStreamDelta: (cb: (data: any) => void) => {
      ipcRenderer.on('claude:stream-delta', (_, data) => cb(data))
    },
    onSystem: (cb: (data: any) => void) => {
      ipcRenderer.on('claude:system', (_, data) => cb(data))
    },
    onAssistant: (cb: (data: any) => void) => {
      ipcRenderer.on('claude:assistant', (_, data) => cb(data))
    },
    onResult: (cb: (data: any) => void) => {
      ipcRenderer.on('claude:result', (_, data) => cb(data))
    },
    onError: (cb: (data: any) => void) => {
      ipcRenderer.on('claude:error', (_, data) => cb(data))
    },
    onAborted: (cb: () => void) => {
      ipcRenderer.on('claude:aborted', () => cb())
    },
    removeAllListeners: () => {
      ['claude:stream-delta', 'claude:system', 'claude:assistant',
       'claude:result', 'claude:error', 'claude:aborted']
        .forEach(ch => ipcRenderer.removeAllListeners(ch))
    },
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (s: any) => ipcRenderer.invoke('settings:save', s),
  },
  fs: {
    readTree: (dirPath: string) => ipcRenderer.invoke('fs:read-tree', dirPath),
    readFile: (filePath: string) => ipcRenderer.invoke('fs:read-file', filePath),
  },
  pty: {
    create: (opts: any) => ipcRenderer.invoke('pty:create', opts),
    input: (opts: any) => ipcRenderer.invoke('pty:input', opts),
    resize: (opts: any) => ipcRenderer.invoke('pty:resize', opts),
    kill: (tabId: string) => ipcRenderer.invoke('pty:kill', tabId),
    onOutput: (cb: (data: any) => void) => {
      ipcRenderer.on('pty:output', (_, data) => cb(data))
    },
    onExit: (cb: (data: any) => void) => {
      ipcRenderer.on('pty:exit', (_, data) => cb(data))
    },
  },
})
```

- [ ] **Step 3: 创建 global.d.ts**

```typescript
// src/renderer/global.d.ts
interface ClaudeAPI {
  send(opts: { prompt: string; sessionId?: string; cwd?: string }): Promise<void>
  stop(): Promise<void>
  onStreamDelta(cb: (data: { delta: string }) => void): void
  onSystem(cb: (data: { sessionId: string; model: string; tools: string[] }) => void): void
  onAssistant(cb: (data: { content: any[]; costUSD: number; durationMs: number }) => void): void
  onResult(cb: (data: { sessionId: string; subtype: string; costUSD: number; durationMs: number; turns: number }) => void): void
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

interface Window {
  api: {
    claude: ClaudeAPI
    settings: SettingsAPI
    fs: FsAPI
    pty: PtyAPI
  }
}
```

- [ ] **Step 4: 验证编译**

```bash
pnpm exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: IPC 通道 + Preload contextBridge + 类型声明"
```

---

## Task 6: 渲染进程状态改造（流式消息）

**Files:**
- Modify: `src/renderer/state/actions.ts`
- Modify: `src/renderer/state/reducer.ts`
- Modify: `src/renderer/state/store.tsx`

- [ ] **Step 1: 更新 actions.ts 新增 streaming action**

在现有 Action union 末尾追加：

```typescript
// 新增 action 类型
| { type: 'STREAM_DELTA'; sessionId: string; delta: string }
| { type: 'STREAM_END'; sessionId: string; content: any[]; costUSD: number; durationMs: number }
| { type: 'STREAM_ERROR'; sessionId: string; error: string }
| { type: 'STREAM_START'; sessionId: string }
| { type: 'STREAM_ABORTED'; sessionId: string }
| { type: 'SET_SETTINGS'; settings: Partial<{ apiKey: string; model: string; cwd: string }> }
```

- [ ] **Step 2: 更新 reducer.ts 处理 streaming**

在 AppState 新增字段：

```typescript
// AppState 新增
streamingBySession: Record<string, {
  isStreaming: boolean
  currentText: string
  error?: string
}>
settings: { apiKey: string; model: string; cwd: string }
```

在 reducer switch 追加：

```typescript
case 'STREAM_START': {
  return {
    ...state,
    streamingBySession: {
      ...state.streamingBySession,
      [action.sessionId]: { isStreaming: true, currentText: '' }
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
case 'STREAM_END': {
  const { [action.sessionId]: _, ...rest } = state.streamingBySession
  // 把最终消息追加到会话
  const projects = state.projects.map(p => ({
    ...p,
    sessions: p.sessions.map(s =>
      s.id === action.sessionId
        ? { ...s, messages: [...s.messages, { id: `m${Date.now()}`, role: 'assistant' as const, content: action.content.map((b: any) => b.text || '').join('') }] }
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
```

- [ ] **Step 3: 更新 store.tsx 初始化**

从 mock 数据改为真实初始值 + 从 settingsStore 加载：

```typescript
const initialState: AppState = {
  projects: [],  // 从 SDK sessions 动态加载
  activeSessionId: '',
  tabsBySession: {},
  activeTabIdBySession: {},
  theme: ...,
  draft: { text: '' },
  currentView: 'workspace',
  activeSettingsSection: 'general',
  streamingBySession: {},
  settings: { apiKey: '', model: 'sonnet', cwd: '' },
}
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: 渲染进程状态改造 — streaming actions + settings state"
```

---

## Task 7: ChatArea 流式渲染

**Files:**
- Modify: `src/renderer/components/ChatArea.tsx`
- Modify: `src/renderer/components/InputBar.tsx`

- [ ] **Step 1: ChatArea 接入流式消息**

ChatArea 的消息列表需要：
1. 渲染 `session.messages` 中的历史消息（不变）
2. 在消息列表末尾渲染流式消息（从 `streamingBySession[activeSessionId]` 读取）
3. 流式文本用光标闪烁动画
4. 显示费用和耗时（收到 result 时）

关键改动：在消息列表末尾追加一个"流式消息"块：

```tsx
{streaming?.isStreaming && (
  <div style={{ color: 'var(--text)', fontSize: 14, lineHeight: 1.6 }}>
    {streaming.currentText}
    <span style={{ animation: 'blink 1s step-end infinite' }}>▌</span>
  </div>
)}
{streaming?.error && (
  <div style={{ color: 'var(--error)', fontSize: 13 }}>
    ❌ {streaming.error}
  </div>
)}
```

- [ ] **Step 2: InputBar 通过 IPC 发送**

改造 `handleSend`：

```typescript
const handleSend = () => {
  if (!draft.text.trim()) return
  dispatch({ type: 'SEND_MESSAGE' })
  dispatch({ type: 'STREAM_START', sessionId: state.activeSessionId })
  window.api.claude.send({
    prompt: draft.text,
    sessionId: state.activeSessionId || undefined,
    cwd: state.settings.cwd || undefined,
  })
}
```

停止按钮：

```typescript
const handleStop = () => {
  window.api.claude.stop()
}
```

- [ ] **Step 3: ChatArea useEffect 注册 IPC 监听**

```typescript
useEffect(() => {
  const api = window.api.claude
  api.onStreamDelta(({ delta }) => {
    dispatch({ type: 'STREAM_DELTA', sessionId: state.activeSessionId, delta })
  })
  api.onAssistant((data) => {
    // 工具调用等完整消息
  })
  api.onResult((data) => {
    dispatch({ type: 'STREAM_END', sessionId: data.sessionId, ... })
  })
  api.onError(({ error }) => {
    dispatch({ type: 'STREAM_ERROR', sessionId: state.activeSessionId, error })
  })
  api.onAborted(() => {
    dispatch({ type: 'STREAM_ABORTED', sessionId: state.activeSessionId })
  })
  return () => api.removeAllListeners()
}, [state.activeSessionId])
```

- [ ] **Step 4: 验证**

```bash
pnpm exec tsc --noEmit && pnpm test
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: ChatArea 流式渲染 + InputBar IPC 发送"
```

---

## Task 8: 设置页（API Key + 模型）

**Files:**
- Modify: `src/renderer/components/settings/GeneralSettings.tsx`
- Modify: `src/renderer/state/reducer.ts`（settings 加载）

- [ ] **Step 1: GeneralSettings 添加 API Key 输入**

```tsx
// API Key 输入框（密码类型，带显示/隐藏切换）
const [showKey, setShowKey] = useState(false)

<input
  type={showKey ? 'text' : 'password'}
  value={settings.apiKey}
  onChange={(e) => {
    dispatch({ type: 'SET_SETTINGS', settings: { apiKey: e.target.value } })
    window.api.settings.save({ apiKey: e.target.value })
  }}
  placeholder="sk-ant-..."
/>
<button onClick={() => setShowKey(!showKey)}>
  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
</button>
```

模型选择：

```tsx
<select
  value={settings.model}
  onChange={(e) => {
    dispatch({ type: 'SET_SETTINGS', settings: { model: e.target.value } })
    window.api.settings.save({ model: e.target.value })
  }}
>
  <option value="sonnet">Sonnet</option>
  <option value="opus">Opus</option>
  <option value="haiku">Haiku</option>
</select>
```

工作目录：

```tsx
<input
  type="text"
  value={settings.cwd}
  onChange={(e) => {
    dispatch({ type: 'SET_SETTINGS', settings: { cwd: e.target.value } })
    window.api.settings.save({ cwd: e.target.value })
  }}
  placeholder="/path/to/project"
/>
```

- [ ] **Step 2: 应用启动时加载 settings**

在 store.tsx 的 initialState 中同步读取 settings：

```typescript
// 注意：electron-store 是同步的，可以在渲染进程通过 IPC 读取
// 但 initialState 是同步的，所以需要在 App 组件的 useEffect 中加载
useEffect(() => {
  window.api.settings.get().then(s => {
    dispatch({ type: 'SET_SETTINGS', settings: s })
  })
}, [])
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: 设置页 API Key/模型/工作目录 + 启动加载"
```

---

## Task 9: TerminalTab（xterm.js + node-pty）

**Files:**
- Modify: `src/renderer/components/TerminalTab.tsx`

- [ ] **Step 1: 重写 TerminalTab**

```tsx
import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

interface Props {
  tabId: string
  cwd?: string
}

export function TerminalTab({ tabId, cwd }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const createdRef = useRef(false)

  useEffect(() => {
    if (createdRef.current) return
    createdRef.current = true

    const term = new Terminal({
      fontSize: 13,
      fontFamily: 'monospace',
      theme: {
        background: 'var(--bg)',
        foreground: 'var(--text)',
        cursor: 'var(--accent)',
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current!)
    fit.fit()

    termRef.current = term
    fitRef.current = fit

    // 创建 pty
    window.api.pty.create({ tabId, cols: term.cols, rows: term.rows, cwd })

    // pty 输出 → 终端
    window.api.pty.onOutput(({ tabId: id, data }) => {
      if (id === tabId) term.write(data)
    })

    // 终端输入 → pty
    term.onData((data) => {
      window.api.pty.input({ tabId, data })
    })

    // resize
    const onResize = () => {
      fit.fit()
      window.api.pty.resize({ tabId, cols: term.cols, rows: term.rows })
    }
    const observer = new ResizeObserver(onResize)
    observer.observe(containerRef.current!)

    // pty 退出
    window.api.pty.onExit(({ tabId: id }) => {
      if (id === tabId) term.write('\r\n[Process exited]')
    })

    return () => {
      observer.disconnect()
      term.dispose()
      window.api.pty.kill(tabId)
    }
  }, [tabId, cwd])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}
```

- [ ] **Step 2: TabBar 的 terminal 类型渲染 TerminalTab**

在 TabBar 或 RightPanel 中，当 activeTab.type === 'terminal' 时渲染 `<TerminalTab tabId={activeTab.id} />`

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: TerminalTab xterm.js + node-pty 真实终端"
```

---

## Task 10: FileTree 真实文件系统

**Files:**
- Modify: `src/renderer/components/FileTree.tsx`

- [ ] **Step 1: FileTree 从 IPC 读取真实目录树**

```tsx
// 替换 mockFileTrees，从 IPC 读取
useEffect(() => {
  window.api.fs.readTree(settings.cwd).then(tree => {
    setFileTree(tree)
  })
}, [settings.cwd])
```

文件预览：点击文件时调用 `window.api.fs.readFile` 获取内容，在右栏 FileTab 中显示。

- [ ] **Step 2: Commit**

```bash
git commit -m "feat: FileTree 真实文件系统 + 文件预览"
```

---

## Task 11: 会话管理（创建/恢复/列表）

**Files:**
- Modify: `src/renderer/state/reducer.ts`
- Modify: `src/renderer/components/LeftPanel.tsx`

- [ ] **Step 1: 会话从 SDK 加载**

启动时通过 `claude:list-sessions` 获取历史会话列表。新建会话时创建本地 Session 对象，首次发消息时 SDK 自动创建。

- [ ] **Step 2: 会话恢复**

点击历史会话 → 设置 `sessionId` → 下次发消息时 `resume: sessionId`

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: 会话管理（创建/恢复/列表）"
```

---

## Task 12: 清理 mock 数据 + 端到端验收

- [ ] **Step 1: 移除 mockData.ts 的硬编码数据**

保留类型定义，删除 mock 常量。

- [ ] **Step 2: 全量验证**

```bash
pnpm exec tsc --noEmit
pnpm test
pnpm exec electron-vite build
```

- [ ] **Step 3: 手动验收清单**

- [ ] 启动应用，设置页填入 API Key
- [ ] 发送消息，看到流式响应
- [ ] 工具调用正常执行
- [ ] 新建/切换会话
- [ ] 终端 Tab 可用
- [ ] 文件树显示真实目录
- [ ] 主题切换正常

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: 清理 mock 数据 + 端到端验收"
```
