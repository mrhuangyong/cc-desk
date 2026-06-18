# 右上角后台任务面板 实现计划 v2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增右上角悬浮 Panel（内含 TaskCard + BackendTaskCard，三层独立折叠），展示并控制 Claude 起的后台进程。

**Architecture:** 数据源 = SDK `system` 事件（`task_started` → CREATE，`task_notification` → 退出感知）。`task_type === 'local_workflow'` 分叉：backend task（进 BackendTaskCard）vs todo（进 TaskCard）。终止 = `Query.stopTask(taskId)`，已在 `query()` 返回对象上，存引用即用。退出感知 = `task_notification` 原生推送，无需轮询。

**Tech Stack:** Electron + React + Claude Agent SDK v0.3.178 + vitest + @testing-library/react

**前置 spec:** `docs/superpowers/specs/2026-06-18-backend-task-panel-design.md`
**Task 1 验证结论:** 分支 A 确认成立，无退化。

---

## 文件结构

**新建：**
- `src/main/backend-task-registry.ts` — 后台任务生命周期纯逻辑
- `src/renderer/components/BackendTaskPanel.tsx` — 右上角悬浮 Panel 容器
- `src/renderer/components/BackendTaskCard.tsx` — 后台任务 Card
- `tests/backend-task-registry.test.ts` — registry 纯逻辑测试
- `tests/BackendTaskPanel.test.tsx` — Panel UI 测试

**修改：**
- `src/main/claude-service.ts` — task_started 分叉 / task_notification 处理 / 存 stream 引用
- `src/main/index.ts` — 实例化 registry，IPC handler (list/kill)
- `src/preload/index.ts` — 暴露 `window.api.backendTask`
- `src/renderer/types.ts` — BackendTask 类型 + showBackendTask 设置
- `src/renderer/state/reducer.ts` — backendTasksBySession + panelFold
- `src/renderer/state/actions.ts` — 新 action 类型
- `src/renderer/state/store.tsx` — 订阅 backend-task 事件
- `src/renderer/components/TaskPanel.tsx` — 降级为 TaskCard（去掉 absolute）
- `src/renderer/App.tsx` — 渲染 BackendTaskPanel
- `src/main/settings-store.ts` — 默认值加 showBackendTask

---

### Task 2: backend-task-registry 纯逻辑 + 测试

**Files:**
- Create: `src/main/backend-task-registry.ts`
- Test: `tests/backend-task-registry.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/backend-task-registry.test.ts
import { describe, it, expect } from 'vitest'
import { BackendTaskRegistry } from '../src/main/backend-task-registry'

describe('BackendTaskRegistry', () => {
  it('CREATE: task_started(task_type=local_workflow) 创建后台任务', () => {
    const reg = new BackendTaskRegistry()
    reg.handleTaskStarted('s1', {
      task_id: 'tid1', description: '跑 pnpm dev', prompt: 'pnpm dev',
      task_type: 'local_workflow', subagent_type: 'general-purpose',
    })
    const tasks = reg.listBySession('s1')
    expect(tasks).toHaveLength(1)
    expect(tasks[0].id).toBe('tid1')
    expect(tasks[0].command).toBe('跑 pnpm dev')
    expect(tasks[0].taskType).toBe('local_workflow')
    expect(tasks[0].status).toBe('running')
  })

  it('CREATE: command 回退到 prompt 字段', () => {
    const reg = new BackendTaskRegistry()
    reg.handleTaskStarted('s1', {
      task_id: 'tid2', description: '', prompt: 'sleep 30',
      task_type: 'local_workflow',
    })
    expect(reg.listBySession('s1')[0].command).toBe('sleep 30')
  })

  it('SKIP: task_started 无 task_type（普通 todo）不创建后端任务', () => {
    const reg = new BackendTaskRegistry()
    reg.handleTaskStarted('s1', {
      task_id: 'tid3', description: '实现功能 X',
    })
    expect(reg.listBySession('s1')).toHaveLength(0)
  })

  it('task_notification(completed) → 标记 completed', () => {
    const reg = new BackendTaskRegistry()
    reg.handleTaskStarted('s1', {
      task_id: 'tid1', description: 'test', task_type: 'local_workflow',
    })
    reg.handleTaskNotification('s1', { task_id: 'tid1', status: 'completed' })
    expect(reg.listBySession('s1')[0].status).toBe('completed')
  })

  it('task_notification(failed/stopped) → 标记对应状态', () => {
    const reg = new BackendTaskRegistry()
    reg.handleTaskStarted('s1', {
      task_id: 'tid_f', description: 'test', task_type: 'local_workflow',
    })
    reg.handleTaskNotification('s1', { task_id: 'tid_f', status: 'failed' })
    expect(reg.listBySession('s1')[0].status).toBe('failed')
  })

  it('task_notification 未知任务 → 不抛错，不创建', () => {
    const reg = new BackendTaskRegistry()
    expect(() => reg.handleTaskNotification('s1', { task_id: 'unknown', status: 'completed' })).not.toThrow()
  })

  it('会话隔离：不同 localSessionId 互不干扰', () => {
    const reg = new BackendTaskRegistry()
    reg.handleTaskStarted('s1', { task_id: 'a', description: 'A', task_type: 'local_workflow' })
    reg.handleTaskStarted('s2', { task_id: 'b', description: 'B', task_type: 'local_workflow' })
    expect(reg.listBySession('s1')).toHaveLength(1)
    expect(reg.listBySession('s2')).toHaveLength(1)
    expect(reg.listBySession('s1')[0].command).toBe('A')
  })

  it('isManaged: 判断 task_id 是否在 registry 中', () => {
    const reg = new BackendTaskRegistry()
    reg.handleTaskStarted('s1', { task_id: 'tid1', description: 'test', task_type: 'local_workflow' })
    expect(reg.isManaged('tid1')).toBe(true)
    expect(reg.isManaged('unknown')).toBe(false)
  })

  it('handleTaskUpdated: patch status 更新', () => {
    const reg = new BackendTaskRegistry()
    reg.handleTaskStarted('s1', { task_id: 'tid1', description: 'test', task_type: 'local_workflow' })
    reg.handleTaskUpdated('s1', { task_id: 'tid1', patch: { status: 'running' } })
    expect(reg.listBySession('s1')[0].status).toBe('running')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test tests/backend-task-registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: 实现 registry**

```typescript
// src/main/backend-task-registry.ts
export type BackendTaskStatus = 'running' | 'completed' | 'failed' | 'stopped'

export interface BackendTask {
  id: string              // SDK task_id
  localSessionId: string
  command: string         // task_started 的 description || prompt
  taskType?: string       // SDK task_type
  status: BackendTaskStatus
  startedAt: number
  lastKnownAt: number
}

interface TaskStartedEvent {
  task_id: string
  description?: string
  prompt?: string
  task_type?: string
  subagent_type?: string
}

interface TaskUpdatedEvent {
  task_id: string
  patch: { status?: string; description?: string }
}

interface TaskNotificationEvent {
  task_id: string
  status: 'completed' | 'failed' | 'stopped'
}

export class BackendTaskRegistry {
  private tasks = new Map<string, BackendTask>()

  handleTaskStarted(localSessionId: string, e: TaskStartedEvent): BackendTask | null {
    if (e.task_type !== 'local_workflow') return null
    if (this.tasks.has(e.task_id)) return this.tasks.get(e.task_id)!
    const t: BackendTask = {
      id: e.task_id,
      localSessionId,
      command: e.description || e.prompt || '(后台任务)',
      taskType: e.task_type,
      status: 'running',
      startedAt: Date.now(),
      lastKnownAt: Date.now(),
    }
    this.tasks.set(e.task_id, t)
    return t
  }

  handleTaskUpdated(localSessionId: string, e: TaskUpdatedEvent): BackendTask | null {
    const t = this.tasks.get(e.task_id)
    if (!t || t.localSessionId !== localSessionId) return null
    if (e.patch.status) {
      t.status = mapStatus(e.patch.status)
    }
    t.lastKnownAt = Date.now()
    return t
  }

  handleTaskNotification(localSessionId: string, e: TaskNotificationEvent): BackendTask | null {
    const t = this.tasks.get(e.task_id)
    if (!t || t.localSessionId !== localSessionId) return null
    t.status = e.status
    t.lastKnownAt = Date.now()
    return t
  }

  listBySession(localSessionId: string): BackendTask[] {
    return [...this.tasks.values()].filter(t => t.localSessionId === localSessionId)
  }

  isManaged(taskId: string): boolean {
    return this.tasks.has(taskId)
  }
}

function mapStatus(s: string): BackendTaskStatus {
  switch (s) {
    case 'completed': return 'completed'
    case 'failed': case 'killed': return 'failed'
    case 'stopped': return 'stopped'
    default: return 'running'
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test tests/backend-task-registry.test.ts`
Expected: ALL 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/backend-task-registry.ts tests/backend-task-registry.test.ts
git commit -m "feat: backend-task-registry (task_started/task_notification 驱动)"
```

---

### Task 3: claude-service.ts — task_started 分叉 + task_notification + 存 stream

**Files:**
- Modify: `src/main/claude-service.ts`

- [ ] **Step 1: 修改 claude-service.ts**

1. 顶部 import registry:

```typescript
import type { BackendTaskRegistry } from './backend-task-registry'
```

2. 类字段加 `streamRef` 和 `registry`:

```typescript
export class ClaudeService {
  private abortController: AbortController | null = null
  private dialogResolvers = new Map<string, ...>()
  // 存 stream(Query) 引用，暴露 stopTask
  private streamRef: Awaited<ReturnType<typeof query>> | null = null
  private registry: BackendTaskRegistry | null = null

  setRegistry(r: BackendTaskRegistry): void { this.registry = r }

  async stopTask(taskId: string): Promise<void> {
    await this.streamRef?.stopTask(taskId)
  }
  ...
}
```

3. `send` 方法里 `const stream = query({...})` 之后保存引用:

```typescript
    try {
      const stream = query({ ... })
      this.streamRef = stream  // 存引用供 stopTask 用
      ...
```

4. `send` 方法签名加 `registry` 参数（或通过 setter 注入，由 index.ts 调 `claude.setRegistry(backendTaskRegistry)`）：

5. 在 `system` 事件的 switch 里改 `task_started` 分叉（line 193-203 附近）：

```typescript
          case 'task_started': {
            const tm = message as any
            // 分叉：local_workflow → backend task；否则 → 现有 claude:task
            if (tm.task_type === 'local_workflow' && this.registry) {
              const t = this.registry.handleTaskStarted(lsid, {
                task_id: tm.task_id,
                description: tm.description ?? '',
                prompt: tm.prompt ?? '',
                task_type: tm.task_type,
                subagent_type: tm.subagent_type,
              })
              if (t) {
                webContents.send('claude:backend-task', { localSessionId: lsid, op: 'create', task: t })
              }
            } else {
              // 保持现有行为：进 claude:task → TaskCard（待办）
              webContents.send('claude:task', {
                localSessionId: lsid, kind: 'started',
                taskId: tm.task_id, description: tm.description ?? '', taskType: tm.task_type ?? '',
              })
            }
            break
          }
```

6. 改 `task_notification`（line 216-217，原来只是 log/notice）：

```typescript
          case 'task_notification': {
            const tm = message as any
            // 若在 registry 中 → 更新 backend task
            if (this.registry?.isManaged(tm.task_id)) {
              const t = this.registry.handleTaskNotification(lsid, {
                task_id: tm.task_id,
                status: tm.status ?? 'completed',
              })
              if (t) {
                webContents.send('claude:backend-task', { localSessionId: lsid, op: 'update', task: t })
              }
            } else {
              // 非 backend task → 也发 claude:task（供 TaskCard 状态更新）
              webContents.send('claude:task', {
                localSessionId: lsid, kind: 'updated',
                taskId: tm.task_id,
                patch: { status: tm.status ?? 'completed' },
              })
            }
            break
          }
```

7. 改 `task_updated` 也同时发 backend-task:

```typescript
          case 'task_updated': {
            const tm = message as any
            if (this.registry?.isManaged(tm.task_id)) {
              const t = this.registry.handleTaskUpdated(lsid, {
                task_id: tm.task_id,
                patch: tm.patch ?? {},
              })
              if (t) {
                webContents.send('claude:backend-task', { localSessionId: lsid, op: 'update', task: t })
              }
            }
            // 同时保持现有 claude:task 行为
            webContents.send('claude:task', {
              localSessionId: lsid, kind: 'updated',
              taskId: tm.task_id, patch: tm.patch ?? {},
            })
            break
          }
```

8. `finally` 里清 streamRef:

```typescript
    } finally {
      this.abortController = null
      this.streamRef = null
    }
```

- [ ] **Step 2: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无类型错误。若有，修正。

- [ ] **Step 3: Commit**

```bash
git add src/main/claude-service.ts
git commit -m "feat: claude-service task_started分叉 + task_notification退出感知 + streamRef"
```

---

### Task 4: index.ts 注入 registry + IPC handler (list/kill)

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: 修改 index.ts**

1. Import:

```typescript
import { BackendTaskRegistry } from './backend-task-registry'
```

2. 实例化紧接 `const claude = new ClaudeService()`:

```typescript
const backendTaskRegistry = new BackendTaskRegistry()
claude.setRegistry(backendTaskRegistry)
```

3. IPC handler（在 pty handler 之后）：

```typescript
  // 后台任务
  ipcMain.handle('backend-task:list', (_e, localSessionId: string) => {
    return backendTaskRegistry.listBySession(localSessionId)
  })

  ipcMain.handle('backend-task:kill', async (_e, localSessionId: string, taskId: string) => {
    try {
      await claude.stopTask(taskId)
      backendTaskRegistry.handleTaskNotification(localSessionId, { task_id: taskId, status: 'stopped' })
      const t = backendTaskRegistry.listBySession(localSessionId).find(x => x.id === taskId)
      if (t) win.webContents.send('claude:backend-task', { localSessionId, op: 'update', task: t })
      return { ok: true }
    } catch (err) {
      console.error('[backend-task] kill failed', taskId, err)
      return { ok: false, error: String(err) }
    }
  })
```

- [ ] **Step 2: 类型检查**

Run: `pnpm exec tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: 后台任务 IPC handler + registry 注入"
```

---

### Task 5: preload + renderer types + reducer + actions + store

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/types.ts`
- Modify: `src/renderer/state/actions.ts`
- Modify: `src/renderer/state/reducer.ts`
- Modify: `src/renderer/state/store.tsx`
- Modify: `src/main/settings-store.ts`

- [ ] **Step 1: preload 暴露 backendTask API**

在 `src/preload/index.ts` 的 `pty: {...}` 之后加：

```javascript
  backendTask: {
    list: (localSessionId: string) => ipcRenderer.invoke('backend-task:list', localSessionId),
    kill: (localSessionId: string, taskId: string) => ipcRenderer.invoke('backend-task:kill', localSessionId, taskId),
    onEvent: (cb: (data: any) => void) => {
      ipcRenderer.on('claude:backend-task', (_, data) => cb(data))
    },
  },
```

- [ ] **Step 2: types.ts 加类型**

在 `src/renderer/types.ts` 的 `TaskItem` 后：

```typescript
export type BackendTaskStatus = 'running' | 'completed' | 'failed' | 'stopped'
export interface BackendTask {
  id: string
  localSessionId: string
  command: string
  taskType?: string
  status: BackendTaskStatus
  startedAt: number
  lastKnownAt: number
}
```

在 `AppSettings` 的 `showTodo` 后加 `showBackendTask: boolean`。

- [ ] **Step 3: actions.ts 加 action 类型**

```typescript
  | { type: 'UPSERT_BACKEND_TASK'; sessionId: string; task: import('../types').BackendTask }
  | { type: 'CLEAR_BACKEND_TASKS'; sessionId: string }
  | { type: 'SET_PANEL_FOLD'; panel: 'root' | 'taskCard' | 'backendTaskCard'; folded: boolean }
```

- [ ] **Step 4: reducer.ts 加 state 和 reducer case**

`AppState` 加：

```typescript
  backendTasksBySession: Record<string, import('../types').BackendTask[]>
  panelFold: { root: boolean; taskCard: boolean; backendTaskCard: boolean }
```

Reducer case（在 `default` 之前）：

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

- [ ] **Step 5: store.tsx 初始值 + 事件订阅**

`initialState` 加：

```typescript
  backendTasksBySession: {},
  panelFold: { root: false, taskCard: false, backendTaskCard: false },
```

在 `window.api.claude.onTask(...)` 订阅附近加：

```typescript
  window.api.backendTask.onEvent((data: any) => {
    if (!data || !data.task) return
    if (data.op === 'create' || data.op === 'update') {
      dispatch({ type: 'UPSERT_BACKEND_TASK', sessionId: data.localSessionId, task: data.task })
    }
  })
```

- [ ] **Step 6: settings-store.ts 默认值**

在 `src/main/settings-store.ts` 的默认 AppSettings 加 `showBackendTask: true`。

- [ ] **Step 7: global.d.ts 类型声明**

给 `window.api` 类型加 `backendTask` 字段：

```typescript
  backendTask: {
    list: (localSessionId: string) => Promise<any[]>
    kill: (localSessionId: string, taskId: string) => Promise<{ ok: boolean; error?: string }>
    onEvent: (cb: (data: any) => void) => void
  }
```

- [ ] **Step 8: 类型检查 + 现有测试**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: 无新类型错误，所有现有测试 PASS。

- [ ] **Step 9: Commit**

```bash
git add src/preload/index.ts src/renderer/types.ts src/renderer/state/actions.ts src/renderer/state/reducer.ts src/renderer/state/store.tsx src/renderer/global.d.ts src/main/settings-store.ts
git commit -m "feat: 渲染端后台任务 store + preload + IPC 全部接线"
```

---

### Task 6: TaskPanel 降级 + BackendTaskCard + BackendTaskPanel 容器

**Files:**
- Modify: `src/renderer/components/TaskPanel.tsx`
- Create: `src/renderer/components/BackendTaskCard.tsx`
- Create: `src/renderer/components/BackendTaskPanel.tsx`

- [ ] **Step 1: TaskPanel 降级为 TaskCard（去掉 absolute，接收 folded/onToggleFold props）**

```tsx
// src/renderer/components/TaskPanel.tsx（改造）
import { CheckCircle2, Loader2, Circle, XCircle } from 'lucide-react'
import type { TaskStatus, TaskItem } from '../types'

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
  tasks: TaskItem[]
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

- [ ] **Step 2: BackendTaskCard**

```tsx
// src/renderer/components/BackendTaskCard.tsx
import { Loader2, Square } from 'lucide-react'
import type { BackendTask } from '../types'
import { formatSessionTime } from '../utils/formatSessionTime'

const STATUS_LABEL: Record<BackendTask['status'], string> = {
  running: '运行中', completed: '已完成', failed: '已退出', stopped: '已终止',
}

interface Props {
  tasks: BackendTask[]
  folded: boolean
  onToggleFold: () => void
  onKill: (taskId: string) => void
}

export function BackendTaskCard({ tasks, folded, onToggleFold, onKill }: Props) {
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
                <div style={{ color: 'var(--text-faint)', fontSize: 10, marginTop: 2 }}>
                  {STATUS_LABEL[t.status]}
                  {t.startedAt ? ` · ${formatSessionTime(t.startedAt)}` : ''}
                </div>
              </div>
              {t.status === 'running' && (
                <button onClick={() => onKill(t.id)} title="终止" style={{ padding: '2px 6px', color: 'var(--text-muted)', background: 'none', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>
                  <Square size={10} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: BackendTaskPanel 容器**

```tsx
// src/renderer/components/BackendTaskPanel.tsx
import { TaskCard } from './TaskPanel'
import { BackendTaskCard } from './BackendTaskCard'
import type { TaskItem, BackendTask } from '../types'
import type { Dispatch } from 'react'

interface FoldState { root: boolean; taskCard: boolean; backendTaskCard: boolean }

interface Props {
  tasks: TaskItem[]
  backendTasks: BackendTask[]
  showTodo: boolean
  showBackendTask: boolean
  folded: FoldState
  activeSessionId: string
  dispatch: Dispatch<any>
}

export function BackendTaskPanel({ tasks, backendTasks, showTodo, showBackendTask, folded, activeSessionId, dispatch }: Props) {
  const taskVisible = showTodo && tasks.length > 0
  const bgVisible = showBackendTask && backendTasks.length > 0
  if (!taskVisible && !bgVisible) return null

  if (folded.root) {
    return (
      <div style={{ position: 'absolute', top: 12, right: 16, zIndex: 50 }}>
        <button onClick={() => dispatch({ type: 'SET_PANEL_FOLD', panel: 'root', folded: false })}
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12 }}>
          ⊕ 面板
        </button>
      </div>
    )
  }

  return (
    <div style={{ position: 'absolute', top: 12, right: 16, zIndex: 50, width: 280, maxHeight: 480, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={() => dispatch({ type: 'SET_PANEL_FOLD', panel: 'root', folded: true })}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 11 }}>收起 ⊖</button>
      </div>
      {taskVisible && (
        <TaskCard tasks={tasks} folded={folded.taskCard}
          onToggleFold={() => dispatch({ type: 'SET_PANEL_FOLD', panel: 'taskCard', folded: !folded.taskCard })} />
      )}
      {bgVisible && (
        <BackendTaskCard tasks={backendTasks} folded={folded.backendTaskCard}
          onToggleFold={() => dispatch({ type: 'SET_PANEL_FOLD', panel: 'backendTaskCard', folded: !folded.backendTaskCard })}
          onKill={(taskId) => { void window.api.backendTask.kill(activeSessionId, taskId) }} />
      )}
    </div>
  )
}
```

- [ ] **Step 4: 挂到 App.tsx**

在 `src/renderer/App.tsx` 里，把 `<TaskPanel />` 的渲染替换为：

```tsx
<BackendTaskPanel
  tasks={state.tasksBySession[state.activeSessionId] ?? []}
  backendTasks={state.backendTasksBySession[state.activeSessionId] ?? []}
  showTodo={state.settings.showTodo}
  showBackendTask={state.settings.showBackendTask}
  folded={state.panelFold}
  activeSessionId={state.activeSessionId}
  dispatch={dispatch}
/>
```

- [ ] **Step 5: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无类型错误。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/TaskPanel.tsx src/renderer/components/BackendTaskCard.tsx src/renderer/components/BackendTaskPanel.tsx src/renderer/App.tsx
git commit -m "feat: BackendTaskPanel 三层折叠容器 + TaskPanel降级为TaskCard"
```

---

### Task 7: UI 测试 + 端到端验证

**Files:**
- Create: `tests/BackendTaskPanel.test.tsx`

- [ ] **Step 1: 写 UI 测试**

```tsx
// tests/BackendTaskPanel.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BackendTaskPanel } from '../src/renderer/components/BackendTaskPanel'

describe('BackendTaskPanel', () => {
  it('两张 Card 都空 → 不渲染', () => {
    const { container } = render(<BackendTaskPanel tasks={[]} backendTasks={[]}
      showTodo showBackendTask folded={{ root: false, taskCard: false, backendTaskCard: false }}
      activeSessionId="s1" dispatch={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('仅 TaskCard 有内容 → 渲染 TaskCard', () => {
    render(<BackendTaskPanel tasks={[{ id: 't1', description: '任务A', taskType: '', status: 'running' }]} backendTasks={[]}
      showTodo showBackendTask folded={{ root: false, taskCard: false, backendTaskCard: false }}
      activeSessionId="s1" dispatch={() => {}} />)
    expect(screen.getByText('待办')).toBeTruthy()
  })

  it('仅 BackendTaskCard 有内容 → 渲染 BackendTaskCard', () => {
    render(<BackendTaskPanel tasks={[]}
      backendTasks={[{ id: 'b1', localSessionId: 's1', command: 'pnpm dev', status: 'running', startedAt: Date.now(), lastKnownAt: Date.now() }]}
      showTodo showBackendTask folded={{ root: false, taskCard: false, backendTaskCard: false }}
      activeSessionId="s1" dispatch={() => {}} />)
    expect(screen.getByText('后台任务')).toBeTruthy()
    expect(screen.getByText('pnpm dev')).toBeTruthy()
  })

  it('点击 Card 标题切换折叠', () => {
    const dispatch = vi.fn()
    render(<BackendTaskPanel tasks={[]}
      backendTasks={[{ id: 'b1', localSessionId: 's1', command: 'pnpm dev', status: 'running', startedAt: 0, lastKnownAt: 0 }]}
      showTodo showBackendTask folded={{ root: false, taskCard: false, backendTaskCard: false }}
      activeSessionId="s1" dispatch={dispatch} />)
    fireEvent.click(screen.getByText('后台任务'))
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_PANEL_FOLD', panel: 'backendTaskCard', folded: true }))
  })

  it('root 折叠态 → 只显示入口按钮', () => {
    render(<BackendTaskPanel tasks={[{ id: 't1', description: '任务A', taskType: '', status: 'running' }]} backendTasks={[]}
      showTodo showBackendTask folded={{ root: true, taskCard: false, backendTaskCard: false }}
      activeSessionId="s1" dispatch={() => {}} />)
    expect(screen.getByText('⊕ 面板')).toBeTruthy()
    expect(screen.queryByText('待办')).toBeNull()
  })

  it('running 任务显示终止按钮', () => {
    render(<BackendTaskPanel tasks={[]}
      backendTasks={[{ id: 'b1', localSessionId: 's1', command: 'pnpm dev', status: 'running', startedAt: 0, lastKnownAt: 0 }]}
      showTodo showBackendTask folded={{ root: false, taskCard: false, backendTaskCard: false }}
      activeSessionId="s1" dispatch={() => {}} />)
    expect(screen.getByTitle('终止')).toBeTruthy()
  })

  it('completed 任务不显示终止按钮', () => {
    render(<BackendTaskPanel tasks={[]}
      backendTasks={[{ id: 'b2', localSessionId: 's1', command: 'done', status: 'completed', startedAt: 0, lastKnownAt: 0 }]}
      showTodo showBackendTask folded={{ root: false, taskCard: false, backendTaskCard: false }}
      activeSessionId="s1" dispatch={() => {}} />)
    expect(screen.queryByTitle('终止')).toBeNull()
  })
})
```

- [ ] **Step 2: 运行测试确认失败（组件不存在或 import 路径有误）**

Run: `pnpm test tests/BackendTaskPanel.test.tsx`
Expected: FAIL（需修复 setup 配置等）。

- [ ] **Step 3: 修复并确认通过**

Run: `pnpm test tests/BackendTaskPanel.test.tsx`
Expected: ALL 7 tests PASS.

- [ ] **Step 4: 全量测试 + 类型检查**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: 无类型错误，所有测试 PASS。

- [ ] **Step 5: Commit**

```bash
git add tests/BackendTaskPanel.test.tsx
git commit -m "test: BackendTaskPanel UI 测试（三层折叠+显示规则+终止按钮）"
```
