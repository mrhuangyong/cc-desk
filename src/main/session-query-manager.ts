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

  pushMessage(localSessionId: string, prompt: string): void {
    const sq = this.sessions.get(localSessionId)
    if (!sq) return
    sq.controller.push({
      type: 'user',
      message: { role: 'user', content: prompt },
      parent_tool_use_id: null,
    })
  }

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
