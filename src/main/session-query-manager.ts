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
  onEvent: (msg: any) => void        // mutable, updated on each ensureSession
  onError: (err: unknown) => void    // mutable, updated on each ensureSession
  // 是否正在迭代(一轮对话尚未结束)。for await 循环在跑时为 true。
  // 渲染端刷新后据此判断哪些 session 需要重建 streaming 状态。
  isIterating: boolean
}

export interface EnsureSessionOpts {
  localSessionId: string
  resumeId?: string
  webContents: WebContents
  onEvent: (msg: any) => void
  // iterate 抛错时回调（在 handleCrash 清理之前触发），用于通知渲染端清掉 streaming 状态。
  onError: (err: unknown) => void
  buildQuery: (controller: PushController<SDKUserMessage>) => Query
}

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
        return new Promise<IteratorResult<T>>((resolve) => {
          this.resolveNext = resolve
        })
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

  isClosed(): boolean {
    return this.closed
  }
}

export class SessionQueryManager {
  sessions = new Map<string, SessionQuery>()

  ensureSession(opts: EnsureSessionOpts): SessionQuery {
    const existing = this.sessions.get(opts.localSessionId)
    if (existing) {
      // 复用：更新回调到最新（支持窗口重载后新 webContents）
      existing.onEvent = opts.onEvent
      existing.onError = opts.onError
      return existing
    }
    const controller = new PushController<SDKUserMessage>()
    const q = opts.buildQuery(controller)
    const sq: SessionQuery = {
      localSessionId: opts.localSessionId,
      query: q,
      controller,
      onEvent: opts.onEvent,
      onError: opts.onError,
      iterateTask: Promise.resolve(),  // placeholder, set below
      isIterating: false,
    }
    // runIterate reads sq.onEvent/onError (mutable), so pass sq reference
    sq.iterateTask = this.runIterate(opts.localSessionId, sq)
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

  private async runIterate(localSessionId: string, sq: SessionQuery): Promise<void> {
    sq.isIterating = true
    try {
      for await (const message of sq.query) {
        sq.onEvent(message)
      }
    } catch (err) {
      // 用户主动 abort（interrupt 超时后强制中止）:不报错、不触发 onError,
      // 仅清理 session。用户再发消息时 ensureSession 会用 resumeId 续接。
      const isAbort = err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.message))
      if (isAbort) {
        sq.controller.close()
        this.sessions.delete(localSessionId)
      } else {
        // 真正的 crash:通知渲染端 + 本地清理。
        sq.onError(err)
        this.handleCrash(localSessionId, err)
      }
    } finally {
      sq.isIterating = false
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

  /** 指定 session 是否正在迭代（一轮对话尚未结束）。 */
  isIterating(localSessionId: string): boolean {
    return this.sessions.get(localSessionId)?.isIterating ?? false
  }

  /** 返回当前正在迭代的 session id 列表（一轮对话尚未结束）。
   *  渲染端刷新后据此重建 streaming 状态，让续推的新事件正确追加。 */
  runningSessionIds(): string[] {
    return [...this.sessions.values()].filter(sq => sq.isIterating).map(sq => sq.localSessionId)
  }

  /** 更新指定 session 的 onEvent/onError 回调（刷新后 webContents 变了，
   *  需把活跃 session 的事件转发指向新 webContents）。 */
  updateCallbacks(localSessionId: string, onEvent: (msg: any) => void, onError: (err: unknown) => void): void {
    const sq = this.sessions.get(localSessionId)
    if (!sq) return
    sq.onEvent = onEvent
    sq.onError = onError
  }

  async closeAll(): Promise<void> {
    const ids = [...this.sessions.keys()]
    await Promise.all(ids.map(id => this.closeSession(id)))
  }

  async stopTask(localSessionId: string, taskId: string): Promise<void> {
    const sq = this.sessions.get(localSessionId)
    if (!sq) return
    try { await (sq.query as any).stopTask(taskId) } catch (err) { console.error('[session-query] stopTask failed', err) }
  }
}
