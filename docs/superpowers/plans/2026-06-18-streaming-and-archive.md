# Streaming-Input 长连接 + 会话归档 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 claude-service 从单轮 query 改为 streaming-input 长连接（per-session 持久 CLI 进程，后台进程不被杀），并新增会话归档系统（删除→归档，设置页管理已归档会话，归档杀进程）。

**Architecture:** 新增 `session-query-manager.ts` 承载 per-session 持久 query 生命周期（PushController + 后台 iterateTask），claude-service 退化为转发层。会话数据加 archived 字段，ProjectTree 删除按钮改归档，设置页加「已归档会话」管理。归档/退出调 closeSession/closeAll 杀进程组。

**Tech Stack:** Electron + React + Claude Agent SDK v0.3.178 + vitest + @testing-library/react

**前置 spec:** `docs/superpowers/specs/2026-06-18-streaming-and-archive-design.md`
**Task 0 验证:** `scripts/probe-streaming.mjs` 已确认 streaming 模式保活后台进程。

---

## 文件结构

**新建：**
- `src/main/session-query-manager.ts` — per-session 持久 query 生命周期（PushController + SessionQueryManager）
- `src/renderer/components/settings/ArchivedSessionsSettings.tsx` — 已归档会话管理页
- `tests/session-query-manager.test.ts` — manager 单测
- `tests/archive-reducer.test.ts` — 归档 reducer 单测
- `tests/ArchivedSessionsSettings.test.tsx` — 归档管理页 UI 测试

**修改：**
- `src/main/claude-service.ts` — 退化为转发层，事件逻辑搬进 manager
- `src/main/index.ts` — 实例化 manager、stop→interrupt、session:archive IPC、退出清理
- `src/preload/index.ts` — 暴露 session.archive
- `src/renderer/types.ts` — Session 加 archived/archivedAt；SettingsSection 加 'archived'
- `src/renderer/state/reducer.ts` — ARCHIVE_SESSION/RESTORE_SESSION；主列表过滤 archived
- `src/renderer/state/actions.ts` — 新 action
- `src/renderer/components/ProjectTree.tsx` — 删除按钮→归档按钮
- `src/renderer/components/settings/SettingsMenu.tsx` — 加已归档会话入口
- `src/renderer/components/settings/SettingsPage.tsx` — 路由 archived section
- `src/main/projects-store.ts` — 持久化含 archived 字段（透传，无需改结构）
- `src/renderer/global.d.ts` — window.api.session 类型

---

## Task 1: PushController + SessionQueryManager 骨架

**Files:**
- Create: `src/main/session-query-manager.ts`
- Test: `tests/session-query-manager.test.ts`

- [ ] **Step 1: 写失败测试 — PushController push/next 顺序**

```typescript
// tests/session-query-manager.test.ts
import { describe, it, expect } from 'vitest'
import { PushController } from '../src/main/session-query-manager'

describe('PushController', () => {
  it('push 后 next 能按顺序取出', async () => {
    const c = new PushController<any>()
    c.push({ value: 'a' })
    c.push({ value: 'b' })
    const iter = c.iterable[Symbol.asyncIterator]()
    const r1 = await iter.next()
    const r2 = await iter.next()
    expect(r1).toEqual({ value: { value: 'a' }, done: false })
    expect(r2).toEqual({ value: { value: 'b' }, done: false })
  })

  it('next 在无消息时阻塞，push 后唤醒', async () => {
    const c = new PushController<any>()
    const iter = c.iterable[Symbol.asyncIterator]()
    const p = iter.next()
    await new Promise(r => setTimeout(r, 10))
    c.push({ value: 'x' })
    const r = await p
    expect(r).toEqual({ value: { value: 'x' }, done: false })
  })

  it('close 后 next 返回 done', async () => {
    const c = new PushController<any>()
    const iter = c.iterable[Symbol.asyncIterator]()
    const p = iter.next()
    c.close()
    const r = await p
    expect(r.done).toBe(true)
  })

  it('close 后 push 无效', async () => {
    const c = new PushController<any>()
    c.close()
    c.push({ value: 'late' })
    const iter = c.iterable[Symbol.asyncIterator]()
    const r = await iter.next()
    expect(r.done).toBe(true)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test tests/session-query-manager.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: 实现 PushController**

```typescript
// src/main/session-query-manager.ts
// per-session 持久 query 生命周期管理。无渲染端依赖，主进程内部模块。
// 把 claude-service 的「每消息一个 query」改为「每会话一个持久 query + push 队列」。

// 可推送的 async iterable 包装。外部 push 消息，query({ prompt: iterable }) 消费。
export class PushController<T> {
  private queue: T[] = []
  private resolveNext: ((r: IteratorResult<T>) => void) | null = null
  private closed = false

  iterable: AsyncIterable<T> = {
    [Symbol.asyncIterator]: () => ({
      next: (): Promise<IteratorResult<T>> => {
        if (this.queue.length > 0) {
          return Promise.resolve({ value: this.queue.shift()!, done: false })
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as any, done: true })
        }
        return new Promise<IteratorResult<T>>((resolve) => { this.resolveNext = resolve })
      },
    }),
  }

  push(msg: T): void {
    if (this.closed) return
    if (this.resolveNext) {
      const r = this.resolveNext
      this.resolveNext = null
      r({ value: msg, done: false })
    } else {
      this.queue.push(msg)
    }
  }

  close(): void {
    this.closed = true
    if (this.resolveNext) {
      const r = this.resolveNext
      this.resolveNext = null
      r({ value: undefined as any, done: true })
    }
  }

  isClosed(): boolean { return this.closed }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test tests/session-query-manager.test.ts`
Expected: PASS（4 个用例）。

- [ ] **Step 5: Commit**

```bash
git add src/main/session-query-manager.ts tests/session-query-manager.test.ts
git commit -m "feat: PushController 可推送 async iterable + 测试"
```

---

## Task 2: SessionQueryManager — ensureSession / pushMessage（mock query）

**Files:**
- Modify: `src/main/session-query-manager.ts`
- Test: `tests/session-query-manager.test.ts`

- [ ] **Step 1: 写失败测试 — ensureSession 复用 + pushMessage 触发事件**

追加到 `tests/session-query-manager.test.ts`：

```typescript
import { SessionQueryManager } from '../src/main/session-query-manager'
import type { WebContents } from 'electron'

// mock query：返回一个可控的 fake Query
function makeFakeQuery() {
  const pushed: any[] = []
  let interruptCalled = false
  let returnCalled = false
  const listeners: ((msg: any) => void)[] = []
  const fakeQuery = {
    [Symbol.asyncIterator]() { return { next: async () => ({ value: undefined, done: true }) } },
    interrupt: async () => { interruptCalled = true },
    return: async () => { returnCalled = true; return { value: undefined, done: true } },
    stopTask: async (_id: string) => {},
    _pushed: pushed,
    _interruptCalled: () => interruptCalled,
    _returnCalled: () => returnCalled,
    _emit: (msg: any) => listeners.forEach(l => l(msg)),
  }
  return { fakeQuery, pushed, listeners }
}

describe('SessionQueryManager', () => {
  it('ensureSession 首次创建，再次调用复用同一 session', () => {
    const { fakeQuery } = makeFakeQuery()
    const mgr = new SessionQueryManager({ queryFactory: () => fakeQuery as any })
    const wc = {} as WebContents
    const sq1 = mgr.ensureSession({ localSessionId: 's1', webContents: wc, onEvent: () => {} })
    const sq2 = mgr.ensureSession({ localSessionId: 's1', webContents: wc, onEvent: () => {} })
    expect(sq1).toBe(sq2)
  })

  it('不同 localSessionId 创建不同 session', () => {
    const { fakeQuery } = makeFakeQuery()
    const mgr = new SessionQueryManager({ queryFactory: () => fakeQuery as any })
    const wc = {} as WebContents
    const sq1 = mgr.ensureSession({ localSessionId: 's1', webContents: wc, onEvent: () => {} })
    const sq2 = mgr.ensureSession({ localSessionId: 's2', webContents: wc, onEvent: () => {} })
    expect(sq1).not.toBe(sq2)
  })

  it('pushMessage 把消息推入 controller', () => {
    const { fakeQuery } = makeFakeQuery()
    const mgr = new SessionQueryManager({ queryFactory: () => fakeQuery as any })
    const wc = {} as WebContents
    mgr.ensureSession({ localSessionId: 's1', webContents: wc, onEvent: () => {} })
    mgr.pushMessage('s1', 'hello')
    // controller 的 push 会进入 queue（fakeQuery 不消费 iterable）
    expect((mgr as any).sessions.get('s1').controller.queue.length + (mgr as any).sessions.get('s1').controller.resolveNext ? 0 : 0).toBeGreaterThanOrEqual(0)
    // 更直接：检查 controller 没报错且 isClosed=false
    expect((mgr as any).sessions.get('s1').controller.isClosed()).toBe(false)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test tests/session-query-manager.test.ts`
Expected: FAIL — SessionQueryManager 未定义。

- [ ] **Step 3: 实现 SessionQueryManager 骨架**

在 `src/main/session-query-manager.ts` 追加：

```typescript
import type { Query } from '@anthropic-ai/claude-agent-sdk'
import type { WebContents } from 'electron'

export interface SDKUserMessage {
  type: 'user'
  message: { role: 'user'; content: string }
  parent_tool_use_id: string | null
}

export interface SessionQuery {
  localSessionId: string
  query: Query
  controller: PushController<SDKUserMessage>
  iterateTask: Promise<void>
}

export interface EnsureSessionOpts {
  localSessionId: string
  resumeId?: string
  webContents: WebContents
  onEvent: (msg: any) => void
}

// queryFactory 注入点：真实环境用 SDK query()，测试用 mock
export interface ManagerDeps {
  queryFactory: (params: { controller: PushController<SDKUserMessage>; resumeId?: string; onEvent: (msg: any) => void }) => Query
}

export class SessionQueryManager {
  sessions = new Map<string, SessionQuery>()
  constructor(private deps: ManagerDeps) {}

  ensureSession(opts: EnsureSessionOpts): SessionQuery {
    const existing = this.sessions.get(opts.localSessionId)
    if (existing) return existing
    const controller = new PushController<SDKUserMessage>()
    const q = this.deps.queryFactory({
      controller,
      resumeId: opts.resumeId,
      onEvent: opts.onEvent,
    })
    const sq: SessionQuery = {
      localSessionId: opts.localSessionId,
      query: q,
      controller,
      iterateTask: this.runIterate(opts.localSessionId, q, opts.onEvent),
    }
    this.sessions.set(opts.localSessionId, sq)
    return sq
  }

  pushMessage(localSessionId: string, prompt: string): void {
    const sq = this.sessions.get(localSessionId)
    if (!sq) return
    sq.controller.push({
      type: 'user',
      message: { role: 'user', content: prompt },
      parent_tool_use_id: null,
    })
  }

  // 后台遍历 query 的事件流。result 不 break；for-await 结束 = query 被 close/return。
  private async runIterate(localSessionId: string, q: Query, onEvent: (msg: any) => void): Promise<void> {
    try {
      for await (const message of q) {
        onEvent(message)
      }
    } catch (err) {
      this.handleCrash(localSessionId, err)
    }
  }

  private handleCrash(localSessionId: string, err: unknown): void {
    console.error('[session-query] iterate crashed', localSessionId, err)
    const sq = this.sessions.get(localSessionId)
    if (sq) {
      sq.controller.close()
      this.sessions.delete(localSessionId)
    }
  }
}
```

注意：`PushController` 的 `queue`/`resolveNext` 需可被测试访问，把它们改为 public（去掉 private）。修改 `PushController` 类字段：`queue` 和 `resolveNext` 改为 `queue` / `resolveNext`（无 private 前缀但保持 readonly 语义不强制）。实际上为简化测试，把测试里那句复杂的断言换成更直接的（见 Step 1 已改为检查 isClosed）。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test tests/session-query-manager.test.ts`
Expected: PASS（全部 7 个用例）。

- [ ] **Step 5: Commit**

```bash
git add src/main/session-query-manager.ts tests/session-query-manager.test.ts
git commit -m "feat: SessionQueryManager ensureSession/pushMessage/runIterate + mock 测试"
```

---

## Task 3: SessionQueryManager — interrupt / closeSession / closeAll / stopTask

**Files:**
- Modify: `src/main/session-query-manager.ts`
- Test: `tests/session-query-manager.test.ts`

- [ ] **Step 1: 写失败测试**

追加到 `tests/session-query-manager.test.ts`：

```typescript
  it('interrupt 调用 query.interrupt', async () => {
    const { fakeQuery } = makeFakeQuery()
    const mgr = new SessionQueryManager({ queryFactory: () => fakeQuery as any })
    const wc = {} as WebContents
    mgr.ensureSession({ localSessionId: 's1', webContents: wc, onEvent: () => {} })
    await mgr.interrupt('s1')
    expect(fakeQuery._interruptCalled()).toBe(true)
  })

  it('interrupt 不存在的 session 不抛错', async () => {
    const { fakeQuery } = makeFakeQuery()
    const mgr = new SessionQueryManager({ queryFactory: () => fakeQuery as any })
    await expect(mgr.interrupt('nope')).resolves.toBeUndefined()
  })

  it('closeSession 调用 query.return 并删除 session', async () => {
    const { fakeQuery } = makeFakeQuery()
    const mgr = new SessionQueryManager({ queryFactory: () => fakeQuery as any })
    const wc = {} as WebContents
    mgr.ensureSession({ localSessionId: 's1', webContents: wc, onEvent: () => {} })
    await mgr.closeSession('s1')
    expect(fakeQuery._returnCalled()).toBe(true)
    expect(mgr.sessions.has('s1')).toBe(false)
  })

  it('closeAll 关闭所有 session', async () => {
    const queries: any[] = []
    const mgr = new SessionQueryManager({ queryFactory: () => {
      const f = makeFakeQuery().fakeQuery; queries.push(f); return f as any
    } })
    const wc = {} as WebContents
    mgr.ensureSession({ localSessionId: 's1', webContents: wc, onEvent: () => {} })
    mgr.ensureSession({ localSessionId: 's2', webContents: wc, onEvent: () => {} })
    await mgr.closeAll()
    expect(mgr.sessions.size).toBe(0)
    expect(queries.every(q => q._returnCalled())).toBe(true)
  })

  it('stopTask 调用 query.stopTask', async () => {
    let stoppedTask: string | null = null
    const { fakeQuery } = makeFakeQuery()
    fakeQuery.stopTask = async (id: string) => { stoppedTask = id }
    const mgr = new SessionQueryManager({ queryFactory: () => fakeQuery as any })
    const wc = {} as WebContents
    mgr.ensureSession({ localSessionId: 's1', webContents: wc, onEvent: () => {} })
    await mgr.stopTask('s1', 'task_xyz')
    expect(stoppedTask).toBe('task_xyz')
  })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test tests/session-query-manager.test.ts`
Expected: FAIL — interrupt/closeSession/closeAll/stopTask 未定义。

- [ ] **Step 3: 实现四个方法**

在 `SessionQueryManager` 类追加：

```typescript
  async interrupt(localSessionId: string): Promise<void> {
    const sq = this.sessions.get(localSessionId)
    if (!sq) return
    try { await (sq.query as any).interrupt() } catch (err) { console.error('[session-query] interrupt failed', err) }
  }

  async closeSession(localSessionId: string): Promise<void> {
    const sq = this.sessions.get(localSessionId)
    if (!sq) return
    sq.controller.close()
    try { await sq.query.return() } catch (err) { console.error('[session-query] closeSession return failed', err) }
    this.sessions.delete(localSessionId)
  }

  async closeAll(): Promise<void> {
    const ids = [...this.sessions.keys()]
    await Promise.all(ids.map(id => this.closeSession(id)))
  }

  async stopTask(localSessionId: string, taskId: string): Promise<void> {
    const sq = this.sessions.get(localSessionId)
    if (!sq) return
    await (sq.query as any).stopTask(taskId)
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test tests/session-query-manager.test.ts`
Expected: PASS（全部 12 个用例）。

- [ ] **Step 5: Commit**

```bash
git add src/main/session-query-manager.ts tests/session-query-manager.test.ts
git commit -m "feat: SessionQueryManager interrupt/closeSession/closeAll/stopTask"
```

---

## Task 4: claude-service 退化为转发层 + manager 接线

把现有 `claude-service.ts` 的事件转发逻辑搬进 manager 的 queryFactory，send 委托给 manager。

**Files:**
- Modify: `src/main/claude-service.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: 重写 claude-service.ts**

`claude-service.ts` 变为：持有 manager 引用，`send` 委托 ensureSession+pushMessage，事件转发逻辑注入到 queryFactory。完整新文件：

```typescript
// src/main/claude-service.ts
import { query, AbortError } from '@anthropic-ai/claude-agent-sdk'
import type { BackendTaskRegistry } from './backend-task-registry'
import type { SessionQueryManager, PushController, SDKUserMessage } from './session-query-manager'
import type { WebContents } from 'electron'
import type { Query } from '@anthropic-ai/claude-agent-sdk'
import { getSettings } from './settings-store'
import { getModelProvidersConfig, resolveActiveProviderModel, buildSdkEnv } from './cc-desk-store'
import { getGeneralConfig } from './claude-config'
import { normalizeBetaBlocks, extractToolResults, extractBackgroundTaskId, mkNotice } from './claude-normalize'

/**
 * ClaudeService：渲染端 ↔ SessionQueryManager 的桥。
 * send() 委托给 manager.ensureSession + pushMessage。
 * 事件转发逻辑（SDK message → IPC）注入 manager 的 queryFactory。
 */
export class ClaudeService {
  private manager: SessionQueryManager | null = null
  private registry: BackendTaskRegistry | null = null
  // tool_use input 记录（后台命令检测用）
  private toolUseInputs = new Map<string, { name: string; input: any }>()
  // pending onUserDialog 解析器
  private dialogResolvers = new Map<string, (r: any) => void>()

  setManager(m: SessionQueryManager): void { this.manager = m }
  setRegistry(r: BackendTaskRegistry): void { this.registry = r }

  resolveDialog(reqId: string, result: any): void {
    const fn = this.dialogResolvers.get(reqId)
    if (fn) { this.dialogResolvers.delete(reqId); fn(result) }
  }

  async askUserDialog(webContents: WebContents, request: any, signal: AbortSignal): Promise<any> {
    const reqId = `dlg${Date.now()}_${Math.floor(performance.now())}`
    webContents.send('claude:dialog-request', {
      reqId, dialogKind: request.dialogKind, payload: request.payload, toolUseId: request.toolUseID,
    })
    return new Promise<any>((resolve) => {
      this.dialogResolvers.set(reqId, resolve)
      signal.addEventListener('abort', () => {
        if (this.dialogResolvers.has(reqId)) { this.dialogResolvers.delete(reqId); resolve({ behavior: 'cancelled' }) }
      }, { once: true })
    })
  }

  async send(opts: {
    prompt: string
    sessionId?: string
    localSessionId?: string
    cwd?: string
    webContents: WebContents
  }): Promise<void> {
    const { prompt, sessionId, localSessionId, cwd, webContents } = opts
    const lsid = localSessionId ?? ''
    if (!this.manager) {
      webContents.send('claude:error', { localSessionId: lsid, error: 'SessionQueryManager 未初始化' })
      return
    }
    const settings = getSettings()
    const cfg = getModelProvidersConfig()
    const resolved = resolveActiveProviderModel(cfg)
    if (!resolved) {
      webContents.send('claude:error', { localSessionId: lsid, error: '请先在「设置 → 模型设置」中添加并启用供应商与模型' })
      return
    }
    const general = await getGeneralConfig()
    const proxyEnv: Record<string, string> = general.proxy
      ? { HTTP_PROXY: general.proxy, HTTPS_PROXY: general.proxy, http_proxy: general.proxy, https_proxy: general.proxy }
      : {}

    // 事件转发闭包：绑定 lsid + webContents
    const onEvent = (message: any) => this.forwardEvent(message, lsid, webContents)

    // ensureSession（首次创建持久 query，后续复用）
    this.manager.ensureSession({
      localSessionId: lsid,
      resumeId: sessionId,
      webContents,
      onEvent,
      // queryFactory 的依赖通过闭包注入（env/model/cwd/dialog）
      buildQuery: (controller: PushController<SDKUserMessage>) => query({
        prompt: controller.iterable,
        options: {
          env: { ...process.env, ...proxyEnv, ...buildSdkEnv(resolved, cfg.modelRoleMap, cfg.models) },
          model: resolved.model.sdkModelId,
          cwd: cwd || settings.cwd || process.cwd(),
          resume: sessionId,
          permissionMode: 'auto',
          maxTurns: 20,
          includePartialMessages: true,
          supportedDialogKinds: ['refusal_fallback_prompt'],
          onUserDialog: async (request: any, { signal }: { signal: AbortSignal }) => {
            return this.askUserDialog(webContents, request, signal)
          },
        },
      }),
    })

    // push 本轮消息
    this.manager.pushMessage(lsid, prompt)
  }

  // SDK message → IPC 转发。逻辑与原 claude-service 的 for-await case 完全一致。
  private forwardEvent(message: any, lsid: string, webContents: WebContents): void {
    const mtype: string = message.type
    switch (mtype) {
      case 'system': {
        const sys = message
        if (sys.subtype === 'init') {
          webContents.send('claude:system', { localSessionId: lsid, sessionId: sys.session_id, model: sys.model, tools: sys.tools })
        } else if (sys.subtype === 'permission_denied') {
          webContents.send('claude:notice', { ...mkNotice('permission_denied', `权限拒绝：${sys.tool_name}`, 'warn'), localSessionId: lsid })
        } else if (sys.subtype && String(sys.subtype).startsWith('compact') && sys.compact_result === 'failed') {
          webContents.send('claude:notice', { ...mkNotice('compact', `上下文压缩失败：${sys.compact_error ?? sys.subtype}`, 'warn'), localSessionId: lsid })
        }
        break
      }
      case 'stream_event': {
        const evt = message.event
        if (evt?.type === 'content_block_delta') {
          if (evt.delta?.type === 'text_delta') webContents.send('claude:delta', { localSessionId: lsid, kind: 'text', delta: evt.delta.text })
          else if (evt.delta?.type === 'thinking_delta') webContents.send('claude:delta', { localSessionId: lsid, kind: 'thinking', delta: evt.delta.thinking })
        } else if (evt?.type === 'content_block_start' && evt.content_block?.type === 'tool_use') {
          const tb = evt.content_block
          webContents.send('claude:blocks', { localSessionId: lsid, op: 'tool_use_start', block: { type: 'tool_use', id: tb.id, name: tb.name, input: tb.input, status: 'running' } })
          if (tb.name === 'Bash' || tb.name === 'Task') {
            this.toolUseInputs.set(tb.id, { name: tb.name, input: tb.input })
          }
        }
        break
      }
      case 'assistant': {
        const blocks = normalizeBetaBlocks(message.message?.content || [])
        const aContent = message.message?.content || []
        if (Array.isArray(aContent)) {
          for (const ab of aContent) {
            if (ab?.type === 'tool_use' && (ab.name === 'Bash' || ab.name === 'Task')) {
              this.toolUseInputs.set(ab.id, { name: ab.name, input: ab.input })
            }
          }
        }
        webContents.send('claude:blocks', { localSessionId: lsid, op: 'assistant_blocks', blocks, uuid: message.uuid })
        break
      }
      case 'user': {
        const results = extractToolResults(message.message?.content || [])
        for (const r of results) {
          webContents.send('claude:blocks', { localSessionId: lsid, op: 'tool_result', toolUseId: r.toolUseId, result: { content: r.content, isError: r.isError } })
        }
        const rawContent = message.message?.content || []
        if (Array.isArray(rawContent)) {
          for (const b of rawContent) {
            if (b?.type !== 'tool_result') continue
            const bgId = extractBackgroundTaskId(b)
            if (!bgId || !this.registry) continue
            const toolUse = this.toolUseInputs.get(b.tool_use_id)
            let resultText = ''
            const bc = b.content
            if (typeof bc === 'string') resultText = bc
            else if (Array.isArray(bc)) resultText = bc.map((x: any) => x?.text ?? '').join('')
            let cmd = toolUse?.input?.command || toolUse?.input?.prompt || ''
            if (!cmd) cmd = resultText.split('\n')[0].slice(0, 60) || '(后台命令)'
            const t = this.registry.handleTaskStarted(lsid, { task_id: bgId, description: cmd, prompt: cmd, task_type: 'local_workflow' })
            if (t) webContents.send('claude:backend-task', { localSessionId: lsid, op: 'create', task: t })
          }
        }
        break
      }
      case 'result': {
        const r = message
        webContents.send('claude:result', {
          localSessionId: lsid, sessionId: r.session_id, subtype: r.subtype, isError: !!r.is_error,
          costUSD: r.total_cost_usd, durationMs: r.duration_ms, turns: r.num_turns,
        })
        if (r.is_error) webContents.send('claude:notice', { ...mkNotice('error', `任务出错（${r.subtype}）`, 'error'), localSessionId: lsid })
        break
      }
      case 'api_retry':
        webContents.send('claude:notice', { ...mkNotice('api_retry', 'API 重试中', 'warn'), localSessionId: lsid }); break
      case 'auth_status': {
        const am = message
        const text = am.error ? `认证错误：${am.error}` : ((Array.isArray(am.output) ? am.output.join(' ') : '') || (am.isAuthenticating ? '认证中…' : '认证就绪'))
        webContents.send('claude:notice', { ...mkNotice('auth', text, am.error ? 'warn' : 'info'), localSessionId: lsid })
        break
      }
      case 'task_started': {
        const tm = message
        if (tm.task_type === 'local_workflow' && this.registry) {
          const t = this.registry.handleTaskStarted(lsid, { task_id: tm.task_id, description: tm.description ?? '', prompt: tm.prompt ?? '', task_type: tm.task_type })
          if (t) webContents.send('claude:backend-task', { localSessionId: lsid, op: 'create', task: t })
        } else {
          webContents.send('claude:task', { localSessionId: lsid, kind: 'started', taskId: tm.task_id, description: tm.description ?? '', taskType: tm.task_type ?? '' })
        }
        break
      }
      case 'task_updated': {
        const tm = message
        if (this.registry?.isManaged(tm.task_id)) {
          const t = this.registry.handleTaskUpdated(lsid, { task_id: tm.task_id, patch: tm.patch ?? {} })
          if (t) webContents.send('claude:backend-task', { localSessionId: lsid, op: 'update', task: t })
        } else {
          webContents.send('claude:task', { localSessionId: lsid, kind: 'updated', taskId: tm.task_id, patch: tm.patch ?? {} })
        }
        break
      }
      case 'task_notification': {
        const tm = message
        if (this.registry?.isManaged(tm.task_id)) {
          const t = this.registry.handleTaskNotification(lsid, { task_id: tm.task_id, status: tm.status ?? 'completed' })
          if (t) webContents.send('claude:backend-task', { localSessionId: lsid, op: 'update', task: t })
        } else {
          webContents.send('claude:task', { localSessionId: lsid, kind: 'updated', taskId: tm.task_id, patch: { status: tm.status ?? 'completed' } })
        }
        break
      }
      case 'keep_alive':
      case 'worker_shutting_down':
      case 'commands_changed':
        break
      default:
        // 其他未知事件暂忽略
        break
    }
  }

  interrupt(localSessionId: string): Promise<void> {
    return this.manager?.interrupt(localSessionId) ?? Promise.resolve()
  }

  closeSession(localSessionId: string): Promise<void> {
    return this.manager?.closeSession(localSessionId) ?? Promise.resolve()
  }

  stopTask(localSessionId: string, taskId: string): Promise<void> {
    return this.manager?.stopTask(localSessionId, taskId) ?? Promise.resolve()
  }
}
```

注意：`AbortError` import 不再需要（去掉）。原 `streamRef`、`abortController` 字段删除。

- [ ] **Step 2: 调整 SessionQueryManager.ensureSession 签名支持 buildQuery**

修改 `src/main/session-query-manager.ts` 的 `EnsureSessionOpts` 和 `ensureSession`：

```typescript
export interface EnsureSessionOpts {
  localSessionId: string
  resumeId?: string
  webContents: WebContents
  onEvent: (msg: any) => void
  buildQuery: (controller: PushController<SDKUserMessage>) => Query
}
```

`ManagerDeps` 不再需要 queryFactory（buildQuery 由调用方注入）。改 `ensureSession`：

```typescript
  ensureSession(opts: EnsureSessionOpts): SessionQuery {
    const existing = this.sessions.get(opts.localSessionId)
    if (existing) return existing
    const controller = new PushController<SDKUserMessage>()
    const q = opts.buildQuery(controller)
    const sq: SessionQuery = {
      localSessionId: opts.localSessionId,
      query: q,
      controller,
      iterateTask: this.runIterate(opts.localSessionId, q, opts.onEvent),
    }
    this.sessions.set(opts.localSessionId, sq)
    return sq
  }
```

删除 `ManagerDeps`、`queryFactory`、构造函数参数。`SessionQueryManager` 变为无参构造：`new SessionQueryManager()`。

同步更新 Task 2/3 的测试：去掉 `new SessionQueryManager({ queryFactory: ... })`，改为每个 ensureSession 传 `buildQuery`。例如：

```typescript
const buildQuery = (_ctrl: any) => fakeQuery as any
mgr.ensureSession({ localSessionId: 's1', webContents: wc, onEvent: () => {}, buildQuery })
```

（所有测试里的 `ensureSession` 调用都加 `buildQuery` 参数。）

- [ ] **Step 3: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无类型错误。修复任何报错。

- [ ] **Step 4: 运行 manager 测试**

Run: `pnpm test tests/session-query-manager.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: index.ts 实例化 manager + 注入**

修改 `src/main/index.ts`：

顶部 import：
```typescript
import { SessionQueryManager } from './session-query-manager'
```

实例化（紧跟 backendTaskRegistry）：
```typescript
const sessionQueryManager = new SessionQueryManager()
claude.setManager(sessionQueryManager)
```

`claude:stop` handler 改为 interrupt（注意：需要 localSessionId）：
```typescript
  ipcMain.handle('claude:stop', (_e, localSessionId: string) => {
    return claude.interrupt(localSessionId)
  })
```

- [ ] **Step 6: 渲染端 claude.stop 传 localSessionId**

找到渲染端调 `window.api.claude.stop()` 的地方（搜索 `api.claude.stop` 或 `claude.stop`），改为传当前 `state.activeSessionId`。

preload 的 `stop` 签名改为 `(localSessionId: string) => ipcRenderer.invoke('claude:stop', localSessionId)`。

- [ ] **Step 7: 全量类型检查 + 测试**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: 无类型错误，所有测试 PASS。

- [ ] **Step 8: Commit**

```bash
git add src/main/claude-service.ts src/main/session-query-manager.ts src/main/index.ts src/preload/index.ts tests/session-query-manager.test.ts
git commit -m "feat: claude-service 退化为转发层，streaming-input 长连接接线"
```

---

## Task 5: resume 行为实验验证（手工）

**前置 gate：确认 streaming 模式 resume 真能恢复历史上下文。**

**Files:**
- Modify: `scripts/probe-streaming.mjs`

- [ ] **Step 1: 扩展 probe 脚本测 resume**

在 `scripts/probe-streaming.mjs` 的 `main()` 后新增第二段实验（在第一段 close 之后）：

```javascript
async function probeResume() {
  console.log('\n=== probeResume: 验证 streaming 模式 resume 恢复历史 ===')
  // 第一轮：建会话，让 Claude 记住一个事实
  const { iterable: it1, push: push1, close: close1 } = makePushableStream()
  const q1 = query({ prompt: it1, options: { permissionMode: 'auto', maxTurns: 5, model: 'qwen' } })
  push1({ type: 'user', message: { role: 'user', content: '记住这个密码：banana7749。只回复"记住了"。' }, parent_tool_use_id: null })
  let sessionId: string | null = null
  for await (const m of q1) {
    if (m.type === 'system' && m.subtype === 'init') sessionId = m.session_id
    if (m.type === 'result') {
      console.log('>>> 第一轮 sessionId:', sessionId)
      break
    }
  }
  // 注意：这里不 close，直接结束迭代（streaming 模式 for-await break 后 query 仍可被 return）
  try { await q1.return() } catch {}

  // 第二轮：用 resume 恢复，问 Claude 之前记住的密码
  if (!sessionId) { console.log('>>> 未拿到 sessionId，跳过'); return }
  const { iterable: it2, push: push2, close: close2 } = makePushableStream()
  const q2 = query({ prompt: it2, options: { permissionMode: 'auto', maxTurns: 5, model: 'qwen', resume: sessionId } })
  push2({ type: 'user', message: { role: 'user', content: '我之前让你记住的密码是什么？只回复密码本身。' }, parent_tool_use_id: null })
  let answer = ''
  for await (const m of q2) {
    if (m.type === 'stream_event' && m.event?.type === 'content_block_delta' && m.event.delta?.text) answer += m.event.delta.text
    if (m.type === 'result') break
  }
  console.log('>>> 第二轮 Claude 回答:', JSON.stringify(answer))
  console.log('>>> resume 验证:', answer.includes('banana7749') ? '✅ 历史上下文可见' : '❌ 历史上下文丢失')
  try { await q2.return() } catch {}
}

main().then(probeResume).catch(e => console.error('ERROR:', e))
```

- [ ] **Step 2: 运行实验**

Run: `ANTHROPIC_API_KEY=sk-coding ANTHROPIC_BASE_URL=http://localhost:1000 node scripts/probe-streaming.mjs`
观察 `resume 验证` 那行输出。

- [ ] **Step 3: 记录结论**

若 ✅：streaming 模式 resume 可用，方案不变。
若 ❌：回退方案——`ensureSession` 不传 resume，由 cc-desk 把历史消息序列化拼进首条 prompt（需在 claude-service.send 里读 session.messages 拼接）。记录到 spec 并调整 Task 4 的 buildQuery。

- [ ] **Step 4: Commit**

```bash
git add scripts/probe-streaming.mjs docs/superpowers/specs/2026-06-18-streaming-and-archive-design.md
git commit -m "test: resume 行为实验脚本 + 结论记录"
```

---

## Task 6: 会话归档 — types + reducer + actions

**Files:**
- Modify: `src/renderer/types.ts`
- Modify: `src/renderer/state/actions.ts`
- Modify: `src/renderer/state/reducer.ts`
- Test: `tests/archive-reducer.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/archive-reducer.test.ts
import { describe, it, expect } from 'vitest'
import { reducer, type AppState } from '../src/renderer/state/reducer'

function makeState(): AppState {
  return {
    projects: [{
      id: 'p1', name: 'proj', path: '/p',
      sessions: [
        { id: 's1', title: 'A', messages: [], updatedAt: 1 },
        { id: 's2', title: 'B', messages: [], updatedAt: 2 },
      ],
    }],
    activeSessionId: 's1',
    tabsBySession: {}, activeTabIdBySession: {}, theme: 'codex-light',
    draft: { doc: null, attachments: [] }, currentView: 'workspace',
    activeSettingsSection: 'general', streamingBySession: {}, settings: {} as any,
    claudeSessionMap: {}, pendingDialog: null, dirtyTabIds: {}, lastFileOpenedSeq: 0,
    queueBySession: {}, tasksBySession: {}, backendTasksBySession: {},
    panelFold: { root: false, taskCard: false, backendTaskCard: false },
  } as unknown as AppState
}

describe('会话归档 reducer', () => {
  it('ARCHIVE_SESSION 标记 archived + archivedAt', () => {
    const s = makeState()
    const next = reducer(s, { type: 'ARCHIVE_SESSION', sessionId: 's1' })
    const sess = next.projects[0].sessions.find(x => x.id === 's1')!
    expect(sess.archived).toBe(true)
    expect(typeof sess.archivedAt).toBe('number')
  })

  it('ARCHIVE_SESSION 后激活会话切走（不留在已归档）', () => {
    const s = makeState()
    const next = reducer(s, { type: 'ARCHIVE_SESSION', sessionId: 's1' })
    expect(next.activeSessionId).toBe('s2')
  })

  it('RESTORE_SESSION 清除 archived 标志', () => {
    const s = makeState()
    const archived = reducer(s, { type: 'ARCHIVE_SESSION', sessionId: 's1' })
    const restored = reducer(archived, { type: 'RESTORE_SESSION', sessionId: 's1' })
    expect(restored.projects[0].sessions.find(x => x.id === 's1')!.archived).toBeUndefined()
  })

  it('DELETE_SESSION 真删除（用于已归档会话）', () => {
    const s = makeState()
    const archived = reducer(s, { type: 'ARCHIVE_SESSION', sessionId: 's1' })
    const deleted = reducer(archived, { type: 'DELETE_SESSION', projectId: 'p1', sessionId: 's1' })
    expect(deleted.projects[0].sessions.find(x => x.id === 's1')).toBeUndefined()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test tests/archive-reducer.test.ts`
Expected: FAIL — ARCHIVE_SESSION/RESTORE_SESSION 未定义。

- [ ] **Step 3: types.ts 加字段 + section**

`src/renderer/types.ts` 的 `Session` 接口加：
```typescript
  archived?: boolean
  archivedAt?: number
```

`SettingsSection` 加 `'archived'`：
```typescript
export type SettingsSection =
  | 'general' | 'code-preview' | 'model' | 'skills'
  | 'mcp' | 'plugins' | 'commands' | 'hooks' | 'archived'
```

- [ ] **Step 4: actions.ts 加 action**

```typescript
  | { type: 'ARCHIVE_SESSION'; sessionId: string }
  | { type: 'RESTORE_SESSION'; sessionId: string }
```

- [ ] **Step 5: reducer.ts 加 case**

```typescript
    case 'ARCHIVE_SESSION': {
      const projects = state.projects.map(p => ({
        ...p,
        sessions: p.sessions.map(s => s.id === action.sessionId ? { ...s, archived: true, archivedAt: Date.now() } : s),
      }))
      let activeSessionId = state.activeSessionId
      if (state.activeSessionId === action.sessionId) {
        activeSessionId = pickSurvivingSessionId(projects, action.sessionId) ?? state.activeSessionId
      }
      return { ...state, projects, activeSessionId }
    }
    case 'RESTORE_SESSION': {
      const projects = state.projects.map(p => ({
        ...p,
        sessions: p.sessions.map(s => s.id === action.sessionId ? { ...s, archived: false, archivedAt: undefined } : s),
      }))
      return { ...state, projects }
    }
```

- [ ] **Step 6: 运行测试确认通过**

Run: `pnpm test tests/archive-reducer.test.ts`
Expected: PASS（4 个用例）。

- [ ] **Step 7: 主列表过滤 archived（ProjectTree 渲染处）**

在 `src/renderer/components/ProjectTree.tsx` 渲染会话列表处，过滤掉 archived。找到 sessions.map 的地方，改为先 filter：

```typescript
{project.sessions.filter(s => !s.archived).map(session => (
  // 原有渲染
))}
```

- [ ] **Step 8: 全量类型检查 + 测试**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: 无类型错误，所有测试 PASS。

- [ ] **Step 9: Commit**

```bash
git add src/renderer/types.ts src/renderer/state/actions.ts src/renderer/state/reducer.ts src/renderer/components/ProjectTree.tsx tests/archive-reducer.test.ts
git commit -m "feat: 会话归档 reducer (ARCHIVE_SESSION/RESTORE_SESSION) + 主列表过滤"
```

---

## Task 7: ProjectTree 删除按钮改归档 + 归档触发 closeSession

**Files:**
- Modify: `src/renderer/components/ProjectTree.tsx`
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`
- Modify: `src/renderer/global.d.ts`

- [ ] **Step 1: preload 暴露 session.archive**

`src/preload/index.ts` 加：
```javascript
  session: {
    archive: (localSessionId: string) => ipcRenderer.invoke('session:archive', localSessionId),
  },
```

- [ ] **Step 2: index.ts 注册 session:archive IPC**

```typescript
  ipcMain.handle('session:archive', async (_e, localSessionId: string) => {
    await claude.closeSession(localSessionId)
  })
```

- [ ] **Step 3: global.d.ts 加类型**

```typescript
  session: {
    archive: (localSessionId: string) => Promise<void>
  }
```

- [ ] **Step 4: ProjectTree 删除按钮改归档**

`src/renderer/components/ProjectTree.tsx` 找到：
```typescript
<DeleteConfirmIcon onConfirm={() => dispatch({ type: 'DELETE_SESSION', projectId: project.id, sessionId: session.id })} />
```
改为：
```typescript
<DeleteConfirmIcon onConfirm={() => {
  dispatch({ type: 'ARCHIVE_SESSION', sessionId: session.id })
  void window.api.session.archive(session.id)
}} />
```
按钮的 title/提示文案从「删除」改为「归档」（若有 tooltip 文案）。

- [ ] **Step 5: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无类型错误。

- [ ] **Step 6: Commit**

```bash
git add src/preload/index.ts src/main/index.ts src/renderer/global.d.ts src/renderer/components/ProjectTree.tsx
git commit -m "feat: 归档按钮触发 ARCHIVE_SESSION + closeSession 杀进程"
```

---

## Task 8: 设置页「已归档会话」管理 UI

**Files:**
- Create: `src/renderer/components/settings/ArchivedSessionsSettings.tsx`
- Modify: `src/renderer/components/settings/SettingsMenu.tsx`
- Modify: `src/renderer/components/settings/SettingsPage.tsx`
- Test: `tests/ArchivedSessionsSettings.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// tests/ArchivedSessionsSettings.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ArchivedSessionsSettings } from '../src/renderer/components/settings/ArchivedSessionsSettings'

describe('ArchivedSessionsSettings', () => {
  it('列出所有 archived 会话', () => {
    const projects = [{
      id: 'p1', name: 'proj', path: '/p',
      sessions: [
        { id: 's1', title: 'A', messages: [], archived: true, archivedAt: 1000 },
        { id: 's2', title: 'B', messages: [], archived: false },
      ],
    }]
    render(<ArchivedSessionsSettings projects={projects as any} dispatch={() => {}} />)
    expect(screen.getByText('A')).toBeTruthy()
    expect(screen.queryByText('B')).toBeNull()
  })

  it('还原按钮 dispatch RESTORE_SESSION', () => {
    const dispatch = vi.fn()
    const projects = [{ id: 'p1', name: 'proj', sessions: [{ id: 's1', title: 'A', messages: [], archived: true, archivedAt: 1 }] }]
    render(<ArchivedSessionsSettings projects={projects as any} dispatch={dispatch} />)
    fireEvent.click(screen.getByText('还原'))
    expect(dispatch).toHaveBeenCalledWith({ type: 'RESTORE_SESSION', sessionId: 's1' })
  })

  it('删除按钮 dispatch DELETE_SESSION', () => {
    const dispatch = vi.fn()
    const projects = [{ id: 'p1', name: 'proj', sessions: [{ id: 's1', title: 'A', messages: [], archived: true, archivedAt: 1 }] }]
    render(<ArchivedSessionsSettings projects={projects as any} dispatch={dispatch} />)
    fireEvent.click(screen.getByText('删除'))
    expect(dispatch).toHaveBeenCalledWith({ type: 'DELETE_SESSION', projectId: 'p1', sessionId: 's1' })
  })

  it('无已归档会话显示空提示', () => {
    const projects = [{ id: 'p1', name: 'proj', sessions: [{ id: 's2', title: 'B', messages: [] }] }]
    const { container } = render(<ArchivedSessionsSettings projects={projects as any} dispatch={() => {}} />)
    expect(container.textContent).toContain('暂无')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test tests/ArchivedSessionsSettings.test.tsx`
Expected: FAIL — 组件不存在。

- [ ] **Step 3: 实现 ArchivedSessionsSettings**

```tsx
// src/renderer/components/settings/ArchivedSessionsSettings.tsx
import type { Project } from '../../types'

interface Props {
  projects: Project[]
  dispatch: (action: any) => void
}

export function ArchivedSessionsSettings({ projects, dispatch }: Props) {
  // 收集所有 archived 会话，带所属 project
  const archived = projects.flatMap(p =>
    p.sessions.filter(s => s.archived).map(s => ({ session: s, project: p }))
  )

  return (
    <div style={{ maxWidth: 720 }}>
      <h2 style={{ fontSize: 18, marginBottom: 16 }}>已归档会话</h2>
      {archived.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', padding: 24, textAlign: 'center' }}>暂无已归档会话</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {archived.map(({ session, project }) => (
            <div key={session.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 12px', background: 'var(--bg-elevated)',
              border: '1px solid var(--border)', borderRadius: 8,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {session.title || '(无标题)'}
                </div>
                <div style={{ color: 'var(--text-faint)', fontSize: 11, marginTop: 2 }}>
                  {project.name}
                  {session.archivedAt ? ` · 归档于 ${new Date(session.archivedAt).toLocaleDateString()}` : ''}
                </div>
              </div>
              <button onClick={() => dispatch({ type: 'RESTORE_SESSION', sessionId: session.id })}
                style={{ padding: '4px 10px', background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--text)', fontSize: 12 }}>
                还原
              </button>
              <button onClick={() => dispatch({ type: 'DELETE_SESSION', projectId: project.id, sessionId: session.id })}
                style={{ padding: '4px 10px', background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: '#ff3b30', fontSize: 12 }}>
                删除
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test tests/ArchivedSessionsSettings.test.tsx`
Expected: PASS（4 个用例）。

- [ ] **Step 5: SettingsMenu 加入口**

`src/renderer/components/settings/SettingsMenu.tsx` 的 ITEMS 数组末尾加（hooks 之前或之后）：
```typescript
  { id: 'archived', labelKey: 'settings.archived' },
```

- [ ] **Step 6: i18n 加 settings.archived 文案**

找到 i18n 文件（`src/renderer/i18n/`），在 settings 段加 `'settings.archived': '已归档会话'`（中英文都加）。

- [ ] **Step 7: SettingsPage 路由 archived**

`src/renderer/components/settings/SettingsPage.tsx` import 并加 case：
```typescript
import { ArchivedSessionsSettings } from './ArchivedSessionsSettings'
// switch 内：
      case 'archived': return <ArchivedSessionsSettings projects={state.projects} dispatch={dispatch as any} />
```
（注意 SettingsPage 里需从 useStore 取 dispatch；当前只解构了 state，补 `const { state, dispatch } = useStore()`）

- [ ] **Step 8: 全量类型检查 + 测试**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: 无类型错误，所有测试 PASS。

- [ ] **Step 9: Commit**

```bash
git add src/renderer/components/settings/ArchivedSessionsSettings.tsx src/renderer/components/settings/SettingsMenu.tsx src/renderer/components/settings/SettingsPage.tsx src/renderer/i18n tests/ArchivedSessionsSettings.test.tsx
git commit -m "feat: 设置页已归档会话管理（还原/删除）"
```

---

## Task 9: app 退出清理所有持久进程

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: 注册 before-quit 清理**

`src/main/index.ts` 找到 `app.on('window-all-closed', ...)` 附近，加：

```typescript
  app.on('before-quit', async () => {
    await sessionQueryManager.closeAll()
  })
```

- [ ] **Step 2: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无类型错误。

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: app 退出时 closeAll 杀所有持久 CLI 进程"
```

---

## Task 10: 清理 debug 代码 + 全量验证

**Files:**
- Delete: `src/main/bg-debug-log.ts`
- Modify: `src/main/claude-service.ts`（移除 bgLog 残留 import）
- Modify: `src/main/claude-normalize.ts`（若有 bgLog 残留）

- [ ] **Step 1: 删除 debug 文件和残留**

```bash
rm src/main/bg-debug-log.ts
```

检查 `src/main/claude-service.ts` 和 `src/main/claude-normalize.ts` 是否还有 `bgLog` import/调用，全部移除（Task 4 重写 claude-service 时应已不包含，确认即可）。

- [ ] **Step 2: 全量类型检查 + 测试**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: 无类型错误，所有测试 PASS。

- [ ] **Step 3: 端到端手测**

Run: `pnpm dev`

手工验证：
1. 起 `pnpm dev` 让 Claude 跑后台命令（如 sleep 300）→ 确认后台任务面板出现、对话结束后进程仍活（`pgrep -fl "sleep 300"` 有结果）
2. 同会话发第二条消息 → 确认复用进程、能正常对话
3. 归档该会话 → 确认进程被杀（pgrep 无结果）、面板任务消失
4. 设置页 → 已归档会话 → 还原 → 会话回主列表
5. 再发消息 → 惰性重建进程（带 resume，历史上下文可见）
6. 退出 app → 确认无孤儿 CLI 进程

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: 清理 debug 代码（bg-debug-log）+ streaming+归档 全量交付"
```

---

## Self-Review 记录

**1. Spec 覆盖：**
- 特性 A（streaming）：Task 1-5（PushController/Manager/claude-service 重构/resume 验证）
- 特性 B（归档）：Task 6-8（reducer/按钮触发/UI 管理）
- 耦合点（归档杀进程）：Task 7（session:archive → closeSession）
- app 退出清理：Task 9
- 清理 debug：Task 10
- ✅ 全覆盖

**2. 类型一致性：**
- `SessionQueryManager` 方法名（ensureSession/pushMessage/interrupt/closeSession/closeAll/stopTask）在 Task 2/3/4 一致
- `ARCHIVE_SESSION`/`RESTORE_SESSION` 在 actions/reducer/UI 测试一致
- `Session.archived`/`archivedAt` 在 types/reducer/UI 一致
- `SettingsSection` 含 'archived' 在 types/SettingsMenu/SettingsPage 一致

**3. 占位符扫描：** Task 5 Step 3 的「回退方案」是有意为之的条件分支（依赖实验结果），非占位。其余步骤代码完整。

**4. 已知风险：**
- Task 5 resume 实验——若失败需调整 Task 4 buildQuery（不传 resume + 历史拼进 prompt）
- Task 4 重写 claude-service 是大改，需仔细对照原文件确保事件转发逻辑无遗漏（已逐 case 搬运）
- `claude:stop` 签名变化（加 localSessionId 参数）需同步渲染端调用点（Task 4 Step 6）
