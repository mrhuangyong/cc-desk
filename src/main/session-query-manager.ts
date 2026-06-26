import type { Query } from '@anthropic-ai/claude-agent-sdk'
import type { WebContents } from 'electron'

export interface SDKUserMessage {
  type: 'user'
  // content 既可以是纯文本字符串，也可以是 ContentBlock 数组（携带 image 等）。
  // Anthropic Messages API 的 message.content 支持两种形式；图片走数组形式的 image block。
  message: { role: 'user'; content: string | SDKContentBlock[] }
  parent_tool_use_id: string | null
}

// 注入 SDK 的用户消息 content block。text 与 image 是用户发送消息会用到的两种。
// image.source 用 base64 编码（data 为纯 base64，不含 data: 前缀）。
// media_type 用 SDK 要求的字面量联合（image/jpeg|png|gif|webp）。
export type SDKContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: string } }

export interface SessionQuery {
  localSessionId: string
  query: Query
  controller: PushController<SDKUserMessage>
  iterateTask: Promise<void>
  onEvent: (msg: any) => void | Promise<void>  // mutable, updated on each ensureSession. 返回 Promise 时 runIterate 会 await, 用于阻塞式交互(如 AskUserQuestion)。
  onError: (err: unknown) => void    // mutable, updated on each ensureSession
  // 是否正在迭代(一轮对话尚未结束)。for await 循环在跑时为 true。
  // 渲染端刷新后据此判断哪些 session 需要重建 streaming 状态。
  isIterating: boolean
}

export interface EnsureSessionOpts {
  localSessionId: string
  resumeId?: string
  webContents: WebContents
  onEvent: (msg: any) => void | Promise<void>
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
      // controller 被 close（如 AbortError 后的清理），旧 session 已不可用，删除重建
      if (existing.controller.isClosed()) {
        this.sessions.delete(opts.localSessionId)
        return this.ensureSession(opts)
      }
      // 复用：更新回调到最新（支持窗口重载后新 webContents）
      existing.onEvent = opts.onEvent
      existing.onError = opts.onError
      // 旧循环已结束（正常完成或 crash 清理后），重新启动 runIterate 以消费 queue 中的消息
      if (!existing.isIterating) {
        existing.iterateTask = this.runIterate(opts.localSessionId, existing)
      }
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

  /**
   * 向持久 query 注入一条 user turn。
   * prompt 为文本；images 为可选的图片附件（{mediaType, data}，data 为纯 base64）。
   * 有图片时 message.content 组成数组（text + image blocks），否则退回纯字符串形式。
   */
  pushMessage(localSessionId: string, prompt: string, images?: { mediaType: string; data: string }[]): void {
    const sq = this.sessions.get(localSessionId)
    if (!sq) { console.log(`[diag][pushMessage] NO SESSION: lsid=${localSessionId}`); return }
    console.log(`[diag][pushMessage] pushing to controller: lsid=${localSessionId} isIterating=${sq.isIterating} isClosed=${sq.controller.isClosed()} queueLen=${(sq.controller as any).queue?.length}`)
    const content: string | SDKContentBlock[] = images && images.length > 0
      ? [
          ...(prompt ? [{ type: 'text' as const, text: prompt }] : []),
          ...images.map(i => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: i.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: i.data } })),
        ]
      : prompt
    sq.controller.push({
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
    })
  }

  private async runIterate(localSessionId: string, sq: SessionQuery): Promise<void> {
    sq.isIterating = true
    console.log(`[diag][runIterate] START: lsid=${localSessionId}`)
    try {
      for await (const message of sq.query) {
        await sq.onEvent(message)
      }
      console.log(`[diag][runIterate] for-await EXITED normally: lsid=${localSessionId}`)
    } catch (err) {
      console.log(`[diag][runIterate] for-await THREW: lsid=${localSessionId} err=${err instanceof Error ? err.message : err}`)
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
      console.log(`[diag][runIterate] END: lsid=${localSessionId} isIterating=false`)
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

  /**
   * 动态切换权限模式（streaming-input 专属）。
   * 用于「批准计划」后立即把 plan 模式切到执行模式，无需等下一条消息。
   * SDK 的 setPermissionMode 是 control request，会实时生效。
   */
  async setPermissionMode(localSessionId: string, mode: string): Promise<void> {
    const sq = this.sessions.get(localSessionId)
    if (!sq) return
    try { await (sq.query as any).setPermissionMode(mode) } catch (err) { console.error('[session-query] setPermissionMode failed', err) }
  }

  async interrupt(localSessionId: string): Promise<void> {
    const sq = this.sessions.get(localSessionId)
    if (!sq) return
    try { await (sq.query as any).interrupt() } catch (err) { console.error('[session-query] interrupt failed', err) }
  }

  /**
   * 查询当前上下文用量（SDK getContextUsage control request）。
   * 返回 { totalTokens, maxTokens, percentage, categories:[{name,tokens,color,isDeferred}] }。
   * 会话不存在或调用失败返回 null（渲染端据此显示「未知」态）。
   */
  async getContextUsage(localSessionId: string): Promise<any> {
    const sq = this.sessions.get(localSessionId)
    if (!sq) return null
    try { return await (sq.query as any).getContextUsage() } catch (err) { console.error('[session-query] getContextUsage failed', err); return null }
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
  updateCallbacks(localSessionId: string, onEvent: (msg: any) => void | Promise<void>, onError: (err: unknown) => void): void {
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
