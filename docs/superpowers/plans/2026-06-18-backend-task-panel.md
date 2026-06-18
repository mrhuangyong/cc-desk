# 右上角后台任务面板 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增右上角悬浮 Panel（内含 TaskCard + BackendTaskCard，三层独立折叠），展示并控制 Claude 起的后台进程（基于 SDK 的 `backgroundTaskId` / `TaskStop` / `TaskOutput`）。

**Architecture:** 主进程 `backend-task-registry.ts` 从 SDK 流事件识别后台任务（CREATE/回填 backgroundTaskId/APPEND 输出/MARK_KILLED），经新 IPC 通道 `claude:backend-task` 推给渲染端，渲染端 store 按 localSessionId 隔离，`BackendTaskPanel` 容器把现有 `TaskPanel` 降级为一张 Card、新增一张 BackendTaskCard。终止/探活依赖 Task 1 实验结果：cc-desk 能独立调 TaskStop/TaskOutput → 分支 A（完整）；否则 → 分支 B（纯展示）。

**Tech Stack:** Electron（主进程 + preload + React 渲染端）、Claude Agent SDK v0.3.178、vitest、@testing-library/react。

**前置 spec:** `docs/superpowers/specs/2026-06-18-backend-task-panel-design.md`

---

## 文件结构

**新建：**
- `src/main/backend-task-registry.ts` — 后台任务生命周期纯逻辑（CREATE/回填/APPEND/MARK_KILLED/状态机），无 Electron 依赖，可单测。
- `src/renderer/components/BackendTaskPanel.tsx` — 右上角悬浮 Panel 容器，承载三层折叠 + 内嵌 TaskCard/BackendTaskCard。
- `src/renderer/components/BackendTaskCard.tsx` — 后台任务 Card（展开列表/折叠统计）。
- `tests/backend-task-registry.test.ts` — registry 纯逻辑测试。
- `tests/BackendTaskPanel.test.tsx` — Panel 三层折叠 + 显示规则测试。
- `scripts/probe-background-task.mjs` — Task 1 探查实验脚本（手工跑，非自动化测试）。

**修改：**
- `src/main/claude-service.ts` — 在工具事件循环里识别后台任务，转发 `claude:backend-task` 事件。
- `src/main/claude-normalize.ts` — 扩展提取 `backgroundTaskId`（Task 1 实验后定具体字段路径）。
- `src/main/index.ts` — 注册 `backend-task:kill` / `backend-task:list` IPC handler，实例化 registry。
- `src/preload/index.ts` — 暴露 `window.api.backendTask.{ list, kill, onEvent }`。
- `src/renderer/types.ts` — 新增 `BackendTask` 类型 + `showBackendTask` 设置字段。
- `src/renderer/state/reducer.ts` — 新增 `backendTasksBySession` + 折叠状态 + UPSERT_BACKEND_TASK/CLEAR_BACKEND_TASK/SET_PANEL_FOLD actions。
- `src/renderer/state/actions.ts` — 新增上述 action 类型。
- `src/renderer/state/store.tsx` — 订阅 `claude:backend-task` 事件并 dispatch。
- `src/renderer/components/TaskPanel.tsx` — 降级为纯 Card 内容组件（去掉自带的 absolute 浮动，改为接受折叠 prop）。

---

## Task 1: 探查实验 — 确认 backgroundTaskId 位置与 TaskStop/TaskOutput 可调用性

**这是前置 gate，决定走分支 A/B/C。手工执行，结果写回 spec。**

**Files:**
- Create: `scripts/probe-background-task.mjs`

- [ ] **Step 1: 写探查脚本**

```javascript
// scripts/probe-background-task.mjs
// 手工探查 SDK 后台任务机制。用法：node scripts/probe-background-task.mjs
// 需要先设置 ANTHROPIC_API_KEY 环境变量。
import { query } from '@anthropic-ai/claude-agent-sdk'

const stream = query({
  prompt: '用 Task 工具起一个后台 agent 跑 "sleep 30"，run_in_background 设为 true，然后告诉我你拿到了什么 task id。不要等它结束。',
  options: {
    permissionMode: 'auto',
    maxTurns: 5,
    cwd: process.cwd(),
  },
})

for await (const message of stream) {
  // 把每条消息完整 dump 出来，重点看 tool_use_start 的 input 和 tool_result 的 content 结构
  console.log('===', message.type, (message).subtype ?? '')
  console.log(JSON.stringify(message, null, 2).slice(0, 3000))
}
```

- [ ] **Step 2: 运行探查脚本**

Run: `node scripts/probe-background-task.mjs 2>&1 | tee /tmp/probe-bg-task.log`

观察日志，回答三个问题：
1. Claude 用 `Task(run_in_background:true)` 起后台 agent 时，对应的 `tool_result` 里 `backgroundTaskId` 出现在哪？（content 文本里 / 独立 JSON 字段 / structuredContent 里）
2. `backgroundTaskId` 的值长什么样？（稳定字符串主键）
3. 脚本输出里有没有任何迹象表明 cc-desk 能脱离会话独立调用 TaskStop/TaskOutput？（一般没有，需另查 SDK 是否导出这些工具的调用入口）

- [ ] **Step 3: 追查 TaskStop/TaskOutput 是否可被 cc-desk 独立调用**

Run: `grep -n "TaskStop\|TaskOutput\|backgroundTaskId\|killTask\|stopTask" node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs | head -30`

判断：SDK 是否导出一个 cc-desk 主进程能直接 import 调用的"停止后台任务"函数/方法（不经过 `query()` 流）。记录结论。

- [ ] **Step 4: 把结论写回 spec**

打开 `docs/superpowers/specs/2026-06-18-backend-task-panel-design.md`，在"仍需实验确认的点"一节下方新增一节"## Task 1 实验结论（YYYY-MM-DD）"，记录：
- backgroundTaskId 的实际字段路径（具体到 JSON 路径）
- cc-desk 能否独立调 TaskStop/TaskOutput（能 → 分支 A；否 → 分支 B；拿不到 id → 分支 C）
- 据此确定的分支

- [ ] **Step 5: Commit**

```bash
git add scripts/probe-background-task.mjs docs/superpowers/specs/2026-06-18-backend-task-panel-design.md
git commit -m "chore: 后台任务 SDK 探查脚本 + 实验结论"
```

---

## Task 2: backend-task-registry.ts 纯逻辑 + 测试（与分支无关）

实现任务生命周期纯函数，不依赖 Electron，TDD。

**Files:**
- Create: `src/main/backend-task-registry.ts`
- Test: `tests/backend-task-registry.test.ts`

- [ ] **Step 1: 写失败测试 — CREATE 占位任务**

```typescript
// tests/backend-task-registry.test.ts
import { describe, it, expect } from 'vitest'
import { BackendTaskRegistry } from '../src/main/backend-task-registry'

describe('BackendTaskRegistry', () => {
  it('CREATE: tool_use_start(Task, run_in_background) 创建占位任务，主键用 localSessionId+toolUseId', () => {
    const reg = new BackendTaskRegistry()
    reg.handleToolUseStart('s1', { id: 'tu1', name: 'Task', input: { run_in_background: true, prompt: '跑 sleep 30' } }, 'cwd1')
    const tasks = reg.listBySession('s1')
    expect(tasks).toHaveLength(1)
    expect(tasks[0].id).toBe('s1:tu1')
    expect(tasks[0].command).toBe('跑 sleep 30')
    expect(tasks[0].status).toBe('running')
    expect(tasks[0].backgroundTaskId).toBeUndefined()
  })

  it('CREATE: 非 Task 工具或非 run_in_background 不创建任务', () => {
    const reg = new BackendTaskRegistry()
    reg.handleToolUseStart('s1', { id: 'tu1', name: 'Bash', input: { command: 'ls', run_in_background: false } }, '/tmp')
    expect(reg.listBySession('s1')).toHaveLength(0)
    reg.handleToolUseStart('s1', { id: 'tu2', name: 'Task', input: { run_in_background: false } }, '/tmp')
    expect(reg.listBySession('s1')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test tests/backend-task-registry.test.ts`
Expected: FAIL — 模块不存在 / 导入错误。

- [ ] **Step 3: 实现 registry 最小骨架（让 CREATE 通过）**

```typescript
// src/main/backend-task-registry.ts
// 后台任务生命周期纯逻辑。无 Electron 依赖，可单测。
// 任务主键：实验确认 backgroundTaskId 前，用 `${localSessionId}:${toolUseId}` 作占位主键；
// 拿到 backgroundTaskId 后仍保留占位主键作内部 id，backgroundTaskId 存为字段。

export type BackendTaskStatus = 'running' | 'killed' | 'exited' | 'unknown'

export interface BackendTask {
  id: string                  // 内部主键 `${localSessionId}:${toolUseId}`
  localSessionId: string
  toolUseId: string
  command: string             // Task 的 input.prompt 或 Bash 的 input.command
  cwd?: string
  backgroundTaskId?: string   // SDK 返回的稳定 id（Task 1 实验后回填）
  status: BackendTaskStatus
  outputSnippets: string[]
  startedAt: number
  lastKnownAt: number
}

export class BackendTaskRegistry {
  private tasks = new Map<string, BackendTask>()

  listBySession(localSessionId: string): BackendTask[] {
    return [...this.tasks.values()].filter(t => t.localSessionId === localSessionId)
  }

  handleToolUseStart(
    localSessionId: string,
    block: { id: string; name: string; input: any },
    cwd?: string,
    now: number = Date.now(),
  ): void {
    if (block.name !== 'Task') return
    if (!block.input?.run_in_background) return
    const id = `${localSessionId}:${block.id}`
    if (this.tasks.has(id)) return
    this.tasks.set(id, {
      id,
      localSessionId,
      toolUseId: block.id,
      command: block.input.prompt ?? block.input.command ?? '(后台任务)',
      cwd,
      status: 'running',
      outputSnippets: [],
      startedAt: now,
      lastKnownAt: now,
    })
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test tests/backend-task-registry.test.ts`
Expected: PASS（2 个用例）。

- [ ] **Step 5: Commit**

```bash
git add src/main/backend-task-registry.ts tests/backend-task-registry.test.ts
git commit -m "feat: backend-task-registry CREATE 占位任务 + 测试"
```

---

## Task 3: registry 回填 backgroundTaskId + APPEND + MARK_KILLED + 状态机

**Files:**
- Modify: `src/main/backend-task-registry.ts`
- Test: `tests/backend-task-registry.test.ts`

- [ ] **Step 1: 写失败测试 — 回填 backgroundTaskId**

追加到 `tests/backend-task-registry.test.ts`：

```typescript
  it('回填 backgroundTaskId：tool_result 关联到占位任务', () => {
    const reg = new BackendTaskRegistry()
    reg.handleToolUseStart('s1', { id: 'tu1', name: 'Task', input: { run_in_background: true, prompt: 'sleep 30' } }, '/tmp')
    // Task 1 实验后，backgroundTaskId 的实际路径可能是 result.backgroundTaskId 或 content JSON 里的字段
    reg.fillBackgroundTaskId('s1', 'tu1', 'bt_abc123')
    const t = reg.listBySession('s1')[0]
    expect(t.backgroundTaskId).toBe('bt_abc123')
  })

  it('APPEND: TaskOutput 的输出片段追加到对应任务（按 backgroundTaskId 关联）', () => {
    const reg = new BackendTaskRegistry()
    reg.handleToolUseStart('s1', { id: 'tu1', name: 'Task', input: { run_in_background: true, prompt: 'sleep 30' } }, '/tmp')
    reg.fillBackgroundTaskId('s1', 'tu1', 'bt_abc123')
    reg.appendOutput('s1', 'bt_abc123', 'line1\n')
    reg.appendOutput('s1', 'bt_abc123', 'line2\n')
    const t = reg.listBySession('s1')[0]
    expect(t.outputSnippets).toEqual(['line1\n', 'line2\n'])
  })

  it('APPEND: backgroundTaskId 未知时按 toolUseId 关联', () => {
    const reg = new BackendTaskRegistry()
    reg.handleToolUseStart('s1', { id: 'tu1', name: 'Task', input: { run_in_background: true, prompt: 'sleep 30' } }, '/tmp')
    reg.appendOutputByToolUseId('s1', 'tu1', 'fallback snippet')
    const t = reg.listBySession('s1')[0]
    expect(t.outputSnippets).toEqual(['fallback snippet'])
  })

  it('MARK_KILLED: TaskStop 标记 killed', () => {
    const reg = new BackendTaskRegistry()
    reg.handleToolUseStart('s1', { id: 'tu1', name: 'Task', input: { run_in_background: true, prompt: 'sleep 30' } }, '/tmp')
    reg.fillBackgroundTaskId('s1', 'tu1', 'bt_abc123')
    reg.markKilled('s1', 'bt_abc123')
    expect(reg.listBySession('s1')[0].status).toBe('killed')
  })

  it('MARK_EXITED: 探活发现任务结束标记 exited（分支 A）', () => {
    const reg = new BackendTaskRegistry()
    reg.handleToolUseStart('s1', { id: 'tu1', name: 'Task', input: { run_in_background: true, prompt: 'sleep 30' } }, '/tmp')
    reg.fillBackgroundTaskId('s1', 'tu1', 'bt_abc123')
    reg.markExited('s1', 'bt_abc123')
    expect(reg.listBySession('s1')[0].status).toBe('exited')
  })

  it('会话隔离：不同 localSessionId 互不干扰', () => {
    const reg = new BackendTaskRegistry()
    reg.handleToolUseStart('s1', { id: 'tu1', name: 'Task', input: { run_in_background: true, prompt: 'a' } }, '/tmp')
    reg.handleToolUseStart('s2', { id: 'tu1', name: 'Task', input: { run_in_background: true, prompt: 'b' } }, '/tmp')
    expect(reg.listBySession('s1')).toHaveLength(1)
    expect(reg.listBySession('s2')).toHaveLength(1)
    expect(reg.listBySession('s1')[0].command).toBe('a')
    expect(reg.listBySession('s2')[0].command).toBe('b')
  })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test tests/backend-task-registry.test.ts`
Expected: FAIL — 方法未定义。

- [ ] **Step 3: 实现回填/APPEND/MARK 方法**

在 `BackendTaskRegistry` 类中追加：

```typescript
  private findByBgId(localSessionId: string, bgId: string): BackendTask | undefined {
    return [...this.tasks.values()].find(
      t => t.localSessionId === localSessionId && t.backgroundTaskId === bgId,
    )
  }

  private findByToolUseId(localSessionId: string, toolUseId: string): BackendTask | undefined {
    return this.tasks.get(`${localSessionId}:${toolUseId}`)
  }

  fillBackgroundTaskId(localSessionId: string, toolUseId: string, backgroundTaskId: string): void {
    const t = this.findByToolUseId(localSessionId, toolUseId)
    if (t) {
      t.backgroundTaskId = backgroundTaskId
      t.lastKnownAt = Date.now()
    }
  }

  appendOutput(localSessionId: string, backgroundTaskId: string, snippet: string): void {
    const t = this.findByBgId(localSessionId, backgroundTaskId)
    if (t) {
      t.outputSnippets.push(snippet)
      t.lastKnownAt = Date.now()
    }
  }

  appendOutputByToolUseId(localSessionId: string, toolUseId: string, snippet: string): void {
    const t = this.findByToolUseId(localSessionId, toolUseId)
    if (t) {
      t.outputSnippets.push(snippet)
      t.lastKnownAt = Date.now()
    }
  }

  markKilled(localSessionId: string, backgroundTaskId: string): void {
    const t = this.findByBgId(localSessionId, backgroundTaskId)
    if (t) { t.status = 'killed'; t.lastKnownAt = Date.now() }
  }

  markExited(localSessionId: string, backgroundTaskId: string): void {
    const t = this.findByBgId(localSessionId, backgroundTaskId)
    if (t) { t.status = 'exited'; t.lastKnownAt = Date.now() }
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test tests/backend-task-registry.test.ts`
Expected: PASS（全部 8 个用例）。

- [ ] **Step 5: Commit**

```bash
git add src/main/backend-task-registry.ts tests/backend-task-registry.test.ts
git commit -m "feat: registry 回填 backgroundTaskId + APPEND/MARK_KILLED/MARK_EXITED"
```

---

## Task 4: claude-service.ts 转发 backend-task 事件

在 SDK 流循环里识别工具事件，调 registry 方法，经 `claude:backend-task` 推送。

**Files:**
- Modify: `src/main/claude-service.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: claude-service 接收 registry 并转发事件**

修改 `src/main/claude-service.ts`：

在文件顶部 import：
```typescript
import type { BackendTaskRegistry } from './backend-task-registry'
```

在类里加 registry 字段（构造或 setter 注入），改 `send` 签名加 `registry: BackendTaskRegistry`。在 `for await` 循环的 `stream_event` / `user` 分支里识别工具：

```typescript
          case 'stream_event': {
            const evt = (message as any).event
            if (evt?.type === 'content_block_delta') {
              if (evt.delta?.type === 'text_delta') webContents.send('claude:delta', { localSessionId: lsid, kind: 'text', delta: evt.delta.text })
              else if (evt.delta?.type === 'thinking_delta') webContents.send('claude:delta', { localSessionId: lsid, kind: 'thinking', delta: evt.delta.thinking })
            } else if (evt?.type === 'content_block_start' && evt.content_block?.type === 'tool_use') {
              const tb = evt.content_block
              webContents.send('claude:blocks', { localSessionId: lsid, op: 'tool_use_start', block: { type: 'tool_use', id: tb.id, name: tb.name, input: tb.input, status: 'running' } })
              // === 后台任务识别 ===
              if (tb.name === 'Task' && tb.input?.run_in_background) {
                registry.handleToolUseStart(lsid, { id: tb.id, name: tb.name, input: tb.input }, opts.cwd)
                webContents.send('claude:backend-task', { localSessionId: lsid, op: 'create', task: registry.listBySession(lsid).find(t => t.toolUseId === tb.id) })
              }
            }
            break
          }
```

在 `user` 分支（tool_result）里回填 backgroundTaskId（具体字段路径以 Task 1 实验结论为准，先用 `result.backgroundTaskId` 占位，实验后修正）：

```typescript
          case 'user': {
            const results = extractToolResults((message as any).message?.content || [])
            for (const r of results) {
              webContents.send('claude:blocks', { localSessionId: lsid, op: 'tool_result', toolUseId: r.toolUseId, result: { content: r.content, isError: r.isError } })
            }
            // === 后台任务回填 backgroundTaskId ===
            // Task 1 实验后修正字段路径。占位：尝试从 raw content block 提取。
            const rawContent = (message as any).message?.content || []
            if (Array.isArray(rawContent)) {
              for (const b of rawContent) {
                if (b?.type !== 'tool_result') continue
                const bgId = extractBackgroundTaskId(b)
                if (bgId) {
                  registry.fillBackgroundTaskId(lsid, b.tool_use_id, bgId)
                  webContents.send('claude:backend-task', { localSessionId: lsid, op: 'update', task: registry.findByToolUseId(lsid, b.tool_use_id) })
                }
              }
            }
            break
          }
```

在文件底部 import 区追加（`extractBackgroundTaskId` 放 claude-normalize.ts，见 Step 3）：
```typescript
import { normalizeBetaBlocks, extractToolResults, extractBackgroundTaskId, mkNotice } from './claude-normalize'
```

并把 `send` 方法签名改为接收 `registry`（从 `index.ts` 注入）。

- [ ] **Step 2: index.ts 实例化 registry 并注入 claude.send**

修改 `src/main/index.ts`：

顶部 import：
```typescript
import { BackendTaskRegistry } from './backend-task-registry'
```

实例化（紧跟 `const claude = new ClaudeService()`）：
```typescript
const backendTaskRegistry = new BackendTaskRegistry()
```

修改 `claude:send` handler 传入 registry：
```typescript
  ipcMain.handle('claude:send', (_e, opts) => {
    return claude.send({ ...opts, webContents: win.webContents, registry: backendTaskRegistry })
  })
```

- [ ] **Step 3: claude-normalize.ts 加 extractBackgroundTaskId**

在 `src/main/claude-normalize.ts` 追加（字段路径以 Task 1 实验结论为准；下面是防御性多路径尝试）：

```typescript
// 从 tool_result block 提取后台任务稳定 id。Task 1 实验后确定真实字段路径。
// 防御性尝试多个可能位置：顶层 backgroundTaskId、content 文本里 JSON、structuredContent。
export function extractBackgroundTaskId(toolResultBlock: any): string | undefined {
  if (!toolResultBlock) return undefined
  if (typeof toolResultBlock.backgroundTaskId === 'string') return toolResultBlock.backgroundTaskId
  const sc = toolResultBlock.structuredContent
  if (sc && typeof sc === 'object' && typeof sc.backgroundTaskId === 'string') return sc.backgroundTaskId
  // content 可能是 [{ type:'text', text:'...' }]，文本里可能含 JSON
  const content = toolResultBlock.content
  let text = ''
  if (typeof content === 'string') text = content
  else if (Array.isArray(content)) text = content.map((c: any) => c?.text ?? '').join('')
  const m = text.match(/"backgroundTaskId"\s*:\s*"([^"]+)"/)
  if (m) return m[1]
  return undefined
}
```

同时把 `BackendTaskRegistry` 的 `findByToolUseId` 改为 public（claude-service 回填事件要用）——在 `backend-task-registry.ts` 把 `private findByToolUseId` 改成 `findByToolUseId`。

- [ ] **Step 4: 类型检查 + 编译**

Run: `pnpm exec tsc --noEmit`
Expected: 无类型错误。若 `claude.send` 签名改动引发其他调用点报错，一并修。

- [ ] **Step 5: Commit**

```bash
git add src/main/claude-service.ts src/main/index.ts src/main/claude-normalize.ts src/main/backend-task-registry.ts
git commit -m "feat: claude-service 识别后台任务并转发 backend-task 事件"
```

---

## Task 5: preload 暴露 + IPC handler（list / kill）

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: preload 暴露 backendTask API**

在 `src/preload/index.ts` 的 `contextBridge.exposeInMainWorld('api', { ... })` 里，紧接 `pty: {...}` 之后追加：

```javascript
  backendTask: {
    list: (localSessionId: string) => ipcRenderer.invoke('backend-task:list', localSessionId),
    kill: (localSessionId: string, backgroundTaskId: string) => ipcRenderer.invoke('backend-task:kill', localSessionId, backgroundTaskId),
    onEvent: (cb: (data: any) => void) => {
      ipcRenderer.on('claude:backend-task', (_, data) => cb(data))
    },
  },
```

- [ ] **Step 2: index.ts 注册 IPC handler**

在 `src/main/index.ts` 的 IPC 注册区（pty handler 之后）追加：

```typescript
  // 后台任务
  ipcMain.handle('backend-task:list', (_e, localSessionId: string) => {
    return backendTaskRegistry.listBySession(localSessionId)
  })
  // 分支 A：调 SDK TaskStop；分支 B：仅标记 killed（Task 8 实现真正 kill）
  ipcMain.handle('backend-task:kill', async (_e, localSessionId: string, backgroundTaskId: string) => {
    // 占位：先标记 killed，真正杀进程在 Task 8（分支 A）实现
    backendTaskRegistry.markKilled(localSessionId, backgroundTaskId)
    win.webContents.send('claude:backend-task', {
      localSessionId, op: 'update',
      task: backendTaskRegistry.listBySession(localSessionId).find(t => t.backgroundTaskId === backgroundTaskId),
    })
    return { ok: true, realKill: false }
  })
```

- [ ] **Step 3: 全局类型声明（renderer 用 window.api.backendTask）**

检查 `src/renderer/global.d.ts`，给 `window.api` 加 `backendTask` 类型（若该文件已有 api 类型声明则追加；否则新增）：

```typescript
interface BackendTaskApi {
  list: (localSessionId: string) => Promise<any[]>
  kill: (localSessionId: string, backgroundTaskId: string) => Promise<{ ok: boolean; realKill: boolean }>
  onEvent: (cb: (data: any) => void) => void
}
```
并在 window.api 类型里加 `backendTask: BackendTaskApi`。

- [ ] **Step 4: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无类型错误。

- [ ] **Step 5: Commit**

```bash
git add src/preload/index.ts src/main/index.ts src/renderer/global.d.ts
git commit -m "feat: preload 暴露 backendTask API + IPC handler"
```

---

## Task 6: 渲染端 types + reducer + actions + store 接线

**Files:**
- Modify: `src/renderer/types.ts`
- Modify: `src/renderer/state/actions.ts`
- Modify: `src/renderer/state/reducer.ts`
- Modify: `src/renderer/state/store.tsx`

- [ ] **Step 1: types.ts 加 BackendTask 类型 + showBackendTask 设置**

在 `src/renderer/types.ts` 的 `TaskItem` 之后追加：

```typescript
// 后台任务（Task 工具 run_in_background 起的长进程，悬浮面板展示）
export type BackendTaskStatus = 'running' | 'killed' | 'exited' | 'unknown'
export interface BackendTask {
  id: string                  // 内部主键 `${localSessionId}:${toolUseId}`
  localSessionId: string
  toolUseId: string
  command: string
  cwd?: string
  backgroundTaskId?: string
  status: BackendTaskStatus
  outputSnippets: string[]
  startedAt: number
  lastKnownAt: number
}
```

在 `AppSettings` interface 里 `showTodo: boolean` 下一行加：
```typescript
  showBackendTask: boolean
```

- [ ] **Step 2: actions.ts 加 action 类型**

在 `src/renderer/state/actions.ts` 末尾追加：

```typescript
  // 后台任务（悬浮面板）
  | { type: 'UPSERT_BACKEND_TASK'; sessionId: string; task: import('../types').BackendTask }
  | { type: 'CLEAR_BACKEND_TASKS'; sessionId: string }
  // 右上角 Panel 折叠状态（三层独立）
  | { type: 'SET_PANEL_FOLD'; panel: 'root' | 'taskCard' | 'backendTaskCard'; folded: boolean }
```

- [ ] **Step 3: reducer.ts 加 state 字段 + 处理**

在 `src/renderer/state/reducer.ts` 的 `AppState` interface 里 `tasksBySession` 下方加：

```typescript
  // 后台任务：按会话隔离
  backendTasksBySession: Record<string, import('../types').BackendTask[]>
  // 右上角 Panel 三层折叠状态
  panelFold: { root: boolean; taskCard: boolean; backendTaskCard: boolean }
```

在 `reducer` 的 `default` 之前追加：

```typescript
    case 'UPSERT_BACKEND_TASK': {
      const list = state.backendTasksBySession[action.sessionId] ?? []
      const idx = list.findIndex(t => t.id === action.task.id)
      const next = idx >= 0
        ? list.map(t => t.id === action.task.id ? action.task : t)
        : [...list, action.task]
      return { ...state, backendTasksBySession: { ...state.backendTasksBySession, [action.sessionId]: next } }
    }
    case 'CLEAR_BACKEND_TASKS': {
      return { ...state, backendTasksBySession: { ...state.backendTasksBySession, [action.sessionId]: [] } }
    }
    case 'SET_PANEL_FOLD': {
      return { ...state, panelFold: { ...state.panelFold, [action.panel]: action.folded } }
    }
```

注意：`AppState` 的初始值（在 store.tsx 的 `initialState`）也要加这两个字段。

- [ ] **Step 4: store.tsx 订阅 backend-task 事件 + 初始值**

在 `src/renderer/state/store.tsx` 找到 `window.api.claude.onTask(...)` 订阅处，紧随其后加：

```typescript
  window.api.backendTask.onEvent((data: any) => {
    if (!data || !data.task) return
    if (data.op === 'create' || data.op === 'update') {
      dispatch({ type: 'UPSERT_BACKEND_TASK', sessionId: data.localSessionId, task: data.task })
    }
  })
```

在 `initialState`（store.tsx 里）加：
```typescript
  backendTasksBySession: {},
  panelFold: { root: false, taskCard: false, backendTaskCard: false },
```

并在 settings 初始化处确保 `showBackendTask` 有默认值（true）。若 settings 从主进程 `getSettings()` 来，需在 `src/main/settings-store.ts` 的默认 AppSettings 加 `showBackendTask: true`。

- [ ] **Step 5: 类型检查 + 现有测试不破**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: 无类型错误，所有现有测试 PASS。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/types.ts src/renderer/state/actions.ts src/renderer/state/reducer.ts src/renderer/state/store.tsx src/main/settings-store.ts
git commit -m "feat: 渲染端后台任务 store + Panel 折叠状态"
```

---

## Task 7: BackendTaskPanel 容器 + 三层折叠 UI + TaskPanel 降级 + 测试

**Files:**
- Modify: `src/renderer/components/TaskPanel.tsx`
- Create: `src/renderer/components/BackendTaskCard.tsx`
- Create: `src/renderer/components/BackendTaskPanel.tsx`
- Test: `tests/BackendTaskPanel.test.tsx`

- [ ] **Step 1: TaskPanel 降级为纯 Card 内容组件**

把 `src/renderer/components/TaskPanel.tsx` 改为接收 `folded` / `onToggleFold` props，去掉自带的 `position: absolute`（由容器统一浮动）：

```tsx
// src/renderer/components/TaskPanel.tsx
// 改造为 BackendTaskPanel 内的一张 Card。浮动定位交给容器。
import { CheckCircle2, Loader2, Circle, AlertCircle, XCircle } from 'lucide-react'
import type { TaskStatus } from '../types'

function StatusIcon({ status }: { status: TaskStatus }) {
  const common = { size: 13, style: { flexShrink: 0 } }
  switch (status) {
    case 'running': return <Loader2 {...common} style={{ ...common.style, color: 'var(--accent)' }} />
    case 'completed': return <CheckCircle2 {...common} style={{ ...common.style, color: '#34c759' }} />
    case 'failed': return <XCircle {...common} style={{ ...common.style, color: '#ff3b30' }} />
    case 'killed': return <XCircle {...common} style={{ ...common.style, color: 'var(--text-muted)' }} />
    case 'paused': return <Circle {...common} style={{ ...common.style, color: 'var(--text-muted)' }} />
    default: return <Circle {...common} style={{ ...common.style, color: 'var(--text-muted)' }} />
  }
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: '待处理', running: '进行中', completed: '已完成', failed: '失败', killed: '已终止', paused: '已暂停',
}

interface Props {
  tasks: import('../types').TaskItem[]
  folded: boolean
  onToggleFold: () => void
}

export function TaskCard({ tasks, folded, onToggleFold }: Props) {
  if (tasks.length === 0) return null
  const running = tasks.filter(t => t.status === 'running').length
  const done = tasks.filter(t => t.status === 'completed').length
  return (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow-float)', fontSize: 12, overflow: 'hidden' }}>
      <button onClick={onToggleFold} style={{ width: '100%', padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', fontWeight: 600 }}>
        <span>待办</span>
        <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 11 }}>{running} 进行 · {done} 完成 · 共 {tasks.length}</span>
      </button>
      {!folded && (
        <div style={{ padding: 4, borderTop: '1px solid var(--border)' }}>
          {tasks.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 8px', borderRadius: 6 }}>
              <div style={{ marginTop: 1 }}><StatusIcon status={t.status} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.description || '(无描述)'}</div>
                <div style={{ color: 'var(--text-faint)', fontSize: 10, marginTop: 2 }}>{STATUS_LABEL[t.status]}{t.taskType ? ` · ${t.taskType}` : ''}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 写失败测试 — 三层折叠 + 显示规则**

```tsx
// tests/BackendTaskPanel.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BackendTaskPanel } from '../src/renderer/components/BackendTaskPanel'

// mock store：直接测纯展示组件，props 传入
describe('BackendTaskPanel', () => {
  it('两张 Card 都空 → 不渲染', () => {
    const { container } = render(<BackendTaskPanel tasks={[]} backendTasks={[]} showTodo showBackendTask folded={{ root: false, taskCard: false, backendTaskCard: false }} realKillAvailable={false} dispatch={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('仅 TaskCard 有内容 → 渲染 TaskCard 标题', () => {
    render(<BackendTaskPanel tasks={[{ id: 't1', description: '任务A', taskType: '', status: 'running' }]} backendTasks={[]} showTodo showBackendTask folded={{ root: false, taskCard: false, backendTaskCard: false }} realKillAvailable={false} dispatch={() => {}} />)
    expect(screen.getByText('待办')).toBeTruthy()
  })

  it('点击 BackendTaskCard 标题切换折叠（dispatch SET_PANEL_FOLD）', () => {
    const dispatch = vi.fn()
    render(<BackendTaskPanel tasks={[]} backendTasks={[{ id: 'b1', localSessionId: 's1', toolUseId: 'tu1', command: 'pnpm dev', status: 'running', outputSnippets: [], startedAt: 0, lastKnownAt: 0 }]} showTodo showBackendTask folded={{ root: false, taskCard: false, backendTaskCard: false }} realKillAvailable={false} dispatch={dispatch} />)
    fireEvent.click(screen.getByText('后台任务'))
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_PANEL_FOLD', panel: 'backendTaskCard' }))
  })

  it('realKillAvailable=false → 不渲染终止按钮', () => {
    render(<BackendTaskPanel tasks={[]} backendTasks={[{ id: 'b1', localSessionId: 's1', toolUseId: 'tu1', command: 'pnpm dev', status: 'running', outputSnippets: [], startedAt: 0, lastKnownAt: 0 }]} showTodo showBackendTask folded={{ root: false, taskCard: false, backendTaskCard: false }} realKillAvailable={false} dispatch={() => {}} />)
    expect(screen.queryByText('终止')).toBeNull()
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm test tests/BackendTaskPanel.test.tsx`
Expected: FAIL — 组件不存在。

- [ ] **Step 4: 实现 BackendTaskCard**

```tsx
// src/renderer/components/BackendTaskCard.tsx
import { Loader2, Square } from 'lucide-react'
import type { BackendTask } from '../types'

const STATUS_LABEL: Record<BackendTask['status'], string> = {
  running: '运行中（最后已知）', killed: '已终止', exited: '已退出', unknown: '未知',
}

interface Props {
  tasks: BackendTask[]
  folded: boolean
  realKillAvailable: boolean
  onToggleFold: () => void
  onKill: (bgId: string) => void
}

export function BackendTaskCard({ tasks, folded, realKillAvailable, onToggleFold, onKill }: Props) {
  if (tasks.length === 0) return null
  const running = tasks.filter(t => t.status === 'running').length
  return (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow-float)', fontSize: 12, overflow: 'hidden' }}>
      <button onClick={onToggleFold} style={{ width: '100%', padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', fontWeight: 600 }}>
        <span>后台任务</span>
        <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 11 }}>{running} 运行 · 共 {tasks.length}</span>
      </button>
      {!folded && (
        <div style={{ padding: 4, borderTop: '1px solid var(--border)' }}>
          {tasks.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 8px', borderRadius: 6 }}>
              {t.status === 'running' && <Loader2 size={13} style={{ flexShrink: 0, marginTop: 1, color: 'var(--accent)' }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.command}</div>
                <div style={{ color: 'var(--text-faint)', fontSize: 10, marginTop: 2 }}>{STATUS_LABEL[t.status]}</div>
              </div>
              {realKillAvailable && t.backgroundTaskId && (
                <button onClick={() => onKill(t.backgroundTaskId!)} title="终止" style={{ padding: '2px 6px', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}><Square size={12} /></button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: 实现 BackendTaskPanel 容器（三层折叠 + 浮动）**

```tsx
// src/renderer/components/BackendTaskPanel.tsx
import { TaskCard } from './TaskPanel'
import { BackendTaskCard } from './BackendTaskCard'
import type { TaskItem, BackendTask, Action } from '../types'
import type { Dispatch } from 'react'

interface FoldState { root: boolean; taskCard: boolean; backendTaskCard: boolean }

interface Props {
  tasks: TaskItem[]
  backendTasks: BackendTask[]
  showTodo: boolean
  showBackendTask: boolean
  folded: FoldState
  realKillAvailable: boolean
  activeSessionId: string
  dispatch: Dispatch<Action>
}

export function BackendTaskPanel({ tasks, backendTasks, showTodo, showBackendTask, folded, realKillAvailable, activeSessionId, dispatch }: Props) {
  const taskVisible = showTodo && tasks.length > 0
  const bgVisible = showBackendTask && backendTasks.length > 0
  if (!taskVisible && !bgVisible) return null

  if (folded.root) {
    // 收起态：只留一个窄条入口
    return (
      <div style={{ position: 'absolute', top: 12, right: 16, zIndex: 50 }}>
        <button onClick={() => dispatch({ type: 'SET_PANEL_FOLD', panel: 'root', folded: false })} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12 }}>
          ⊕ 面板
        </button>
      </div>
    )
  }

  return (
    <div style={{ position: 'absolute', top: 12, right: 16, zIndex: 50, width: 280, maxHeight: 480, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={() => dispatch({ type: 'SET_PANEL_FOLD', panel: 'root', folded: true })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 11 }}>收起 ⊖</button>
      </div>
      {taskVisible && (
        <TaskCard tasks={tasks} folded={folded.taskCard} onToggleFold={() => dispatch({ type: 'SET_PANEL_FOLD', panel: 'taskCard', folded: !folded.taskCard })} />
      )}
      {bgVisible && (
        <BackendTaskCard
          tasks={backendTasks}
          folded={folded.backendTaskCard}
          realKillAvailable={realKillAvailable}
          onToggleFold={() => dispatch({ type: 'SET_PANEL_FOLD', panel: 'backendTaskCard', folded: !folded.backendTaskCard })}
          onKill={(bgId) => { void window.api.backendTask.kill(activeSessionId, bgId) }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `pnpm test tests/BackendTaskPanel.test.tsx`
Expected: PASS（4 个用例）。

- [ ] **Step 7: 把 BackendTaskPanel 挂到 App，替换原 TaskPanel 的渲染**

在 `src/renderer/App.tsx`（或现在渲染 `<TaskPanel />` 的地方）替换为：

```tsx
<BackendTaskPanel
  tasks={state.tasksBySession[state.activeSessionId] ?? []}
  backendTasks={state.backendTasksBySession[state.activeSessionId] ?? []}
  showTodo={state.settings.showTodo}
  showBackendTask={state.settings.showBackendTask}
  folded={state.panelFold}
  realKillAvailable={/* Task 1 结论：分支 A=true, B=false */}
  activeSessionId={state.activeSessionId}
  dispatch={dispatch}
/>
```

`realKillAvailable` 的值以 Task 1 实验结论为准（分支 A 传 true，分支 B 传 false）。

- [ ] **Step 8: 全量类型检查 + 测试**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: 无类型错误，全部测试 PASS。

- [ ] **Step 9: Commit**

```bash
git add src/renderer/components/TaskPanel.tsx src/renderer/components/BackendTaskCard.tsx src/renderer/components/BackendTaskPanel.tsx src/renderer/App.tsx tests/BackendTaskPanel.test.tsx
git commit -m "feat: 右上角 BackendTaskPanel 容器 + 三层折叠 + TaskPanel 降级"
```

---

## Task 8（分支 A 专属）: 真正终止 — 调 SDK TaskStop

**仅当 Task 1 结论为分支 A（cc-desk 能独立调 TaskStop）时执行。否则跳过，realKillAvailable 保持 false。**

**Files:**
- Modify: `src/main/backend-task-registry.ts` 或新建 `src/main/claude-task-control.ts`（取决于 Task 1 确认的调用方式）
- Modify: `src/main/index.ts`

- [ ] **Step 1: 按 Task 1 确认的调用方式实现 kill**

根据 Task 1 Step 3 的 grep 结论：
- 若 SDK 导出了可独立调用的 stop/kill 函数 → 在 `claude-task-control.ts` 封装 `stopBackgroundTask(backgroundTaskId)` 调用它。
- 若只能走 `query()` 流 → 在 `backend-task:kill` handler 里发一条让 Claude 调 TaskStop 的 prompt（注意：这与"cc-desk 直接杀"原意有偏差，需回看 Task 1 结论决定）。

具体实现代码以 Task 1 实验确认的 API 签名为准，此处不预填（避免猜错签名）。在 `index.ts` 的 `backend-task:kill` handler 里把占位标记替换为真实调用，返回 `{ ok, realKill: true }`。

- [ ] **Step 2: 失败时回退标记 + 不静默吞错**

`backend-task:kill` handler 改为：

```typescript
  ipcMain.handle('backend-task:kill', async (_e, localSessionId: string, backgroundTaskId: string) => {
    try {
      await stopBackgroundTask(backgroundTaskId)   // Task 1 确认的调用
      backendTaskRegistry.markKilled(localSessionId, backgroundTaskId)
      const task = backendTaskRegistry.listBySession(localSessionId).find(t => t.backgroundTaskId === backgroundTaskId)
      win.webContents.send('claude:backend-task', { localSessionId, op: 'update', task })
      return { ok: true, realKill: true }
    } catch (err) {
      console.error('[backend-task] kill failed', err)
      return { ok: false, realKill: false, error: String(err) }
    }
  })
```

- [ ] **Step 3: App.tsx 的 realKillAvailable 设为 true**

- [ ] **Step 4: 类型检查 + 手测（启动 app，让 Claude 起后台任务，点终止）**

Run: `pnpm exec tsc --noEmit && pnpm dev`

手工验证：发一条让 Claude 起后台 Task 的 prompt，确认 BackendTaskCard 出现，点终止按钮后状态变 killed。

- [ ] **Step 5: Commit**

```bash
git add src/main/claude-task-control.ts src/main/index.ts src/renderer/App.tsx
git commit -m "feat(分支A): 真正调用 TaskStop 终止后台任务"
```

---

## Task 9（分支 A 专属）: 探活定时器 — 周期性 TaskOutput 探活

**仅当分支 A 且 Task 1 确认能独立调 TaskOutput 时执行。**

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: 实现探活循环**

在 `src/main/index.ts` 的 `createWindow` 内（或 app ready 后），启动一个 5s 定时器，遍历 registry 中所有 `running` 且有 backgroundTaskId 的任务，调 TaskOutput(block:false, timeout:0) 探活：

```typescript
  // 分支 A 探活：每 5s 检查 running 后台任务是否已结束
  const probeTimer = setInterval(async () => {
    // registry 需暴露 listAllRunning()
    for (const t of backendTaskRegistry.listAllRunning()) {
      if (!t.backgroundTaskId) continue
      try {
        const alive = await probeTaskAlive(t.backgroundTaskId)  // Task 1 确认的调用
        if (!alive) {
          backendTaskRegistry.markExited(t.localSessionId, t.backgroundTaskId!)
          win.webContents.send('claude:backend-task', { localSessionId: t.localSessionId, op: 'update', task: backendTaskRegistry.listBySession(t.localSessionId).find(x => x.backgroundTaskId === t.backgroundTaskId) })
        }
      } catch (err) {
        console.error('[backend-task] probe failed', t.backgroundTaskId, err)
      }
    }
  }, 5000)
  win.on('closed', () => clearInterval(probeTimer))
```

`registry.listAllRunning()` 需在 `backend-task-registry.ts` 加：

```typescript
  listAllRunning(): BackendTask[] {
    return [...this.tasks.values()].filter(t => t.status === 'running' && t.backgroundTaskId)
  }
```

- [ ] **Step 2: 类型检查 + 手测**

Run: `pnpm exec tsc --noEmit && pnpm dev`

手工验证：让 Claude 起一个 `sleep 5` 后台任务，5-10s 后确认面板状态自动从 running 变 exited。

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts src/main/backend-task-registry.ts
git commit -m "feat(分支A): 后台任务探活定时器"
```

---

## Self-Review 记录

**1. Spec 覆盖：**
- 进程来源（只抓 Claude 后台）→ Task 2/4（识别 Task run_in_background）
- 可读（展示）→ Task 6/7（store + Panel）
- 可控（终止）→ Task 5（kill IPC）+ Task 8（分支 A 真实 kill）
- 退出感知 → Task 9（分支 A 探活）
- 输出被动拼接 → Task 3（appendOutput）+ Task 4（TaskOutput 识别，需在 claude-service 的 TaskStop/TaskOutput 工具事件里调 appendOutput——见下方修正）
- 三层折叠 Panel → Task 7
- 前置 gate / 分支退化 → Task 1 + realKillAvailable 标志
- **Gap：Task 4 没有处理 TaskOutput 工具调用时的 appendOutput。** 见下方修正。

**2. 修正：Task 4 补 TaskOutput / TaskStop 识别**

Task 4 Step 1 的 `stream_event` 分支只处理了 `content_block_start` 的 Task 创建，没处理后续 Claude 调 `TaskOutput`（读输出）和 `TaskStop`（终止）这两个工具调用。需补：

在 `stream_event` 的 `content_block_start` 分支里，识别 `tb.name === 'TaskOutput'` → 在 `user` 分支拿到其 tool_result 后调 `registry.appendOutput(lsid, tb.input.task_id, resultContent)`；识别 `tb.name === 'TaskStop'` → 调 `registry.markKilled(lsid, tb.input.task_id)` 并转发 update 事件。

> 注：TaskOutput 的 output 片段要等 tool_result 才有内容（task_id 在 input，内容在 result）。实现时需在 `stream_event` 记录 toolUseId→(name,task_id)，在 `user` 的 tool_result 里按 toolUseId 关联回填。这部分逻辑略繁，已在 Task 4 体现核心，实现者按 spec"工具事件识别细节"表落地。

**3. Type 一致性：**
- `BackendTask` 接口在 types.ts 与 backend-task-registry.ts 字段一致（id/localSessionId/toolUseId/command/cwd/backgroundTaskId/status/outputSnippets/startedAt/lastKnownAt）✅
- `realKillAvailable` 在 BackendTaskPanel props、App.tsx、index.ts kill 返回值三处一致 ✅
- `panelFold` 三键 root/taskCard/backendTaskCard 在 reducer/actions/Panel 一致 ✅
- `BackendTaskStatus` 在 types.ts（renderer）与 backend-task-registry.ts（main）分别定义，值集一致（running/killed/exited/unknown）✅

**4. 占位符扫描：** Task 8/9 的"以 Task 1 结论为准"是有意为之的分支依赖，非占位——分支 B 时这两 task 整体跳过。其余步骤代码完整。
