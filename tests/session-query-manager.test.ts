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
    await new Promise((r) => setTimeout(r, 10))
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
