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
