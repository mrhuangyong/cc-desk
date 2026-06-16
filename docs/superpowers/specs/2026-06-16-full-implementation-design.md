# cc-desk 全量实现 — 架构设计

## 1. 概述

将 cc-desk 从 UI 原型（mock 数据）升级为真实可用的 Claude Code 桌面客户端。核心集成：**Claude Agent SDK**（`@anthropic-ai/claude-agent-sdk`）+ 用户自备 API key。

## 2. 架构总览

```
┌─────────────────────────────────────────────────────┐
│  Renderer Process (React + TypeScript)              │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ │
│  │ ChatArea │ │ LeftPanel│ │RightPanel│ │Settings │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬────┘ │
│       └─────────────┴───────────┴─────────────┘     │
│                    IPC Bridge (contextBridge)        │
├─────────────────────────────────────────────────────┤
│  Main Process (Node.js)                             │
│  ┌──────────────┐ ┌─────────────┐ ┌──────────────┐  │
│  │ClaudeService │ │SessionStore │ │  PtyManager  │  │
│  │(SDK wrapper) │ │(JSONL持久化) │ │(node-pty)    │  │
│  └──────┬───────┘ └──────┬──────┘ └──────┬───────┘  │
│         │                │               │          │
│  ┌──────┴───────┐ ┌──────┴──────┐ ┌──────┴───────┐  │
│  │claude-agent- │ │  fs (disk)  │ │  node-pty    │  │
│  │sdk (子进程)   │ │             │ │  + xterm.js  │  │
│  └──────────────┘ └─────────────┘ └──────────────┘  │
└─────────────────────────────────────────────────────┘
```

## 3. 模块设计

### 3.1 ClaudeService（主进程）

SDK 封装层。核心是 `query()` 异步迭代器 + 侧信道事件。

```typescript
// src/main/claude-service.ts
import { query, tool, createSdkMcpServer, AbortError } from '@anthropic-ai/claude-agent-sdk'
import type { AssistantMessage, ResultMessage, SystemMessage, ToolUseBlock } from '@anthropic-ai/claude-agent-sdk'

class ClaudeService {
  private apiKey: string
  private model: string
  private currentQuery: AsyncGenerator | null = null

  async send(opts: {
    prompt: string
    sessionId?: string
    cwd?: string
    permissionMode?: string
    webContents: Electron.WebContents  // 用于推送侧信道事件
  }): Promise<void> {
    const { prompt, sessionId, cwd, permissionMode, webContents } = opts

    // 通过侧信道捕获流式文本
    let fullText = ''

    try {
      this.currentQuery = query({
        prompt,
        options: {
          apiKey: this.apiKey,
          model: this.model,
          cwd: cwd || process.cwd(),
          resume: sessionId,         // 恢复会话
          permissionMode: permissionMode || 'default',
          maxTurns: 10,
          abortController: this.abortController,

          // 侧信道：实时文本流
          onTextDelta: (delta: string) => {
            fullText += delta
            webContents.send('claude:stream-delta', { delta, fullText })
          },

          // 侧信道：事件追踪
          onTrace: (event: any) => {
            webContents.send('claude:trace', event)
          },
        }
      })

      for await (const message of this.currentQuery) {
        switch (message.type) {
          case 'system':
            // 捕获 session_id 用于后续恢复
            webContents.send('claude:system', {
              sessionId: message.session_id,
              model: message.model,
              tools: message.tools?.map(t => t.name),
            })
            break

          case 'assistant':
            // 包含文本块、工具调用块、思考块
            webContents.send('claude:assistant', {
              content: message.message.content,
              costUSD: message.cost_usd,
              durationMs: message.duration_ms,
            })
            break

          case 'result':
            webContents.send('claude:result', {
              sessionId: message.session_id,
              subtype: message.subtype,
              costUSD: message.total_cost_usd,
              durationMs: message.duration_ms,
              turns: message.num_turns,
              isStreaming: message.is_streaming,
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
      this.currentQuery = null
    }
  }

  // 中止当前对话
  abort(): void {
    this.currentQuery?.return(null)
  }

  // 中断（发送用户消息）
  interrupt(): void {
    // SDK 的 interrupt 机制
  }
}
```

**工具审批（Hooks）：**

SDK 支持 `onPermissionRequest` 钩子，但当前版本更推荐用 `permissionMode` + `allowedTools` 预设。对于需要交互式审批的场景：

- `permissionMode: 'default'` — SDK 会暂停等待，需要通过 SDK 的 hooks 机制处理
- `permissionMode: 'auto'` — 自动批准所有工具
- `permissionMode: 'bypassPermissions'` — 跳过所有检查（仅限隔离环境）

实际方案：用 `permissionMode: 'auto'` + `disallowedTools` 限制危险工具，在渲染进程提供简化审批 UI。

### 3.2 IPC 通道定义

**Main → Renderer（事件推送）：**

| 通道 | 数据 | 说明 |
|------|------|------|
| `claude:stream-delta` | `{ delta, fullText }` | 逐 token 流式文本 |
| `claude:system` | `{ sessionId, model, tools }` | 会话初始化信息 |
| `claude:assistant` | `{ content, costUSD, durationMs }` | 完整 assistant 消息（含工具调用） |
| `claude:result` | `{ sessionId, subtype, costUSD, durationMs, turns }` | 对话结束结果 |
| `claude:error` | `{ error }` | 错误 |
| `claude:aborted` | `void` | 对话被中止 |
| `claude:trace` | `event` | 事件追踪（调试用） |
| `pty:output` | `{ tabId, data }` | 终端输出 |
| `pty:exit` | `{ tabId, code }` | 终端进程退出 |

**Renderer → Main（调用）：**

| 通道 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `claude:send` | `{ prompt, sessionId?, cwd? }` | `void` | 发送消息 |
| `claude:stop` | `void` | `void` | 中止对话 |
| `settings:get` | `void` | `Settings` | 获取设置 |
| `settings:save` | `Settings` | `void` | 保存设置 |
| `fs:read-tree` | `{ dirPath }` | `FileNode[]` | 读目录树 |
| `fs:read-file` | `{ filePath }` | `string` | 读文件内容 |
| `pty:create` | `{ cols, rows, cwd? }` | `{ tabId }` | 创建终端 |
| `pty:input` | `{ tabId, data }` | `void` | 终端输入 |
| `pty:resize` | `{ tabId, cols, rows }` | `void` | 终端 resize |
| `pty:kill` | `{ tabId }` | `void` | 关闭终端 |

### 3.3 Preload（contextBridge）

```typescript
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // Claude
  claude: {
    send: (opts) => ipcRenderer.invoke('claude:send', opts),
    stop: () => ipcRenderer.invoke('claude:stop'),
    onStreamDelta: (cb) => { ipcRenderer.on('claude:stream-delta', (_, data) => cb(data)) },
    onSystem: (cb) => { ipcRenderer.on('claude:system', (_, data) => cb(data)) },
    onAssistant: (cb) => { ipcRenderer.on('claude:assistant', (_, data) => cb(data)) },
    onResult: (cb) => { ipcRenderer.on('claude:result', (_, data) => cb(data)) },
    onError: (cb) => { ipcRenderer.on('claude:error', (_, data) => cb(data)) },
    onAborted: (cb) => { ipcRenderer.on('claude:aborted', () => cb()) },
    removeAllListeners: () => {
      ['claude:stream-delta', 'claude:system', 'claude:assistant',
       'claude:result', 'claude:error', 'claude:aborted']
        .forEach(ch => ipcRenderer.removeAllListeners(ch))
    },
  },
  // Settings
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (s) => ipcRenderer.invoke('settings:save', s),
  },
  // File System
  fs: {
    readTree: (dirPath) => ipcRenderer.invoke('fs:read-tree', dirPath),
    readFile: (filePath) => ipcRenderer.invoke('fs:read-file', filePath),
  },
  // Terminal
  pty: {
    create: (opts) => ipcRenderer.invoke('pty:create', opts),
    input: (data) => ipcRenderer.invoke('pty:input', data),
    resize: (opts) => ipcRenderer.invoke('pty:resize', opts),
    kill: (tabId) => ipcRenderer.invoke('pty:kill', tabId),
    onOutput: (cb) => { ipcRenderer.on('pty:output', (_, data) => cb(data)) },
    onExit: (cb) => { ipcRenderer.on('pty:exit', (_, data) => cb(data)) },
  },
})
```

### 3.4 渲染进程状态改造

**ChatArea 流式渲染流程：**

```
用户输入 → dispatch(SEND_MESSAGE) → ipc.claude.send()
                                         ↓
                        ← claude:stream-delta（逐 token）
                        ← claude:assistant（完整消息 + 工具调用）
                        ← claude:result（结束 + 费用）
```

**新增 state：**

```typescript
interface StreamingState {
  isStreaming: boolean
  currentText: string          // 正在流式接收的文本
  tools: ToolCallInfo[]        // 当前轮次工具调用
  error?: string
}

// 每个会话独立的流式状态
streamingBySession: Record<string, StreamingState>
```

**消息渲染升级：**
- 流式文本逐字显示（光标闪烁）
- 工具调用块折叠展示（工具名 + 输入 + 输出 + 状态图标）
- 思考块（ThinkingBlock）折叠展示
- 结束时显示费用和耗时

### 3.5 终端模块

**PtyManager（主进程）：**

```typescript
import * as pty from 'node-pty'

class PtyManager {
  private processes = new Map<string, pty.IPty>()

  create(tabId: string, cols: number, rows: number, cwd?: string): void {
    const shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || 'bash'
    const p = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols, rows,
      cwd: cwd || process.env.HOME,
    })
    p.onData(data => webContents.send('pty:output', { tabId, data }))
    p.onExit(({ exitCode }) => {
      this.processes.delete(tabId)
      webContents.send('pty:exit', { tabId, code: exitCode })
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
}
```

**TerminalTab（渲染进程）：**
- xterm.js 渲染 + FitAddon 自适应
- `pty.onOutput` → `term.write(data)`
- `term.onData(data)` → `pty.input({ tabId, data })`
- resize 事件同步

### 3.6 文件系统

**FileService（主进程）：**

```typescript
class FileService {
  readTree(dirPath: string, depth = 3): FileNode[] {
    // 递归读目录，限制深度，跳过 node_modules/.git 等
  }

  readFile(filePath: string, maxSize = 1024 * 100): string {
    // 读文件内容，限制大小
  }
}
```

### 3.7 设置持久化

使用 `electron-store`（加密存储 API key）：

```typescript
import Store from 'electron-store'

interface AppSettings {
  apiKey: string
  model: string           // 'sonnet' | 'opus' | 'haiku' 端到端验收（运行时检查）

**提醒：**

> Agent SDK 文档在 `https://docs.anthropic.com/en/docs/claude-code/agent-sdk`。
> Hooks 文档在 `https://docs.anthropic.com/en/docs/claude-code/hooks`。
> 测试时用 `permissionMode: 'bypassPermissions'` 跳过审批，生产用 `'default'`。
> `persistSession: false` 可禁用磁盘持久化（纯内存会话）。
> ASAR 打包需配置 `asar.unpack` 解压 SDK 的 native binary。
> 流式用 `onTextDelta` 回调，不要轮询。
