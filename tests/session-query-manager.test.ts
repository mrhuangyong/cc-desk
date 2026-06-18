import { describe, it, expect } from 'vitest'
import { PushController, SessionQueryManager } from '../src/main/session-query-manager'
import type { WebContents } from 'electron'

function makeFakeQuery() {
  let interruptCalled = false
  let returnCalled = false
  const fakeQuery = {
    [Symbol.asyncIterator]() { return { next: async () => ({ value: undefined, done: true }) } },
    interrupt: async () => { interruptCalled = true },
    return: async () => { returnCalled = true; return { value: undefined, done: true } },
    stopTask: async (_id: string) => {},
    _interruptCalled: () => interruptCalled,
    _returnCalled: () => returnCalled,
  }
  return fakeQuery
}

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

describe('SessionQueryManager', () => {
  it('ensureSession 首次创建，再次调用复用同一 session', () => {
    const fakeQuery = makeFakeQuery()
    const mgr = new SessionQueryManager()
    const wc = {} as WebContents
    const buildQuery = () => fakeQuery as any
    const sq1 = mgr.ensureSession({ localSessionId: 's1', webContents: wc, onEvent: () => {}, onError: () => {}, buildQuery })
    const sq2 = mgr.ensureSession({ localSessionId: 's1', webContents: wc, onEvent: () => {}, onError: () => {}, buildQuery })
    expect(sq1).toBe(sq2)
  })

  it('不同 localSessionId 创建不同 session', () => {
    const fakeQuery = makeFakeQuery()
    const mgr = new SessionQueryManager()
    const wc = {} as WebContents
    const buildQuery = () => fakeQuery as any
    const sq1 = mgr.ensureSession({ localSessionId: 's1', webContents: wc, onEvent: () => {}, onError: () => {}, buildQuery })
    const sq2 = mgr.ensureSession({ localSessionId: 's2', webContents: wc, onEvent: () => {}, onError: () => {}, buildQuery })
    expect(sq1).not.toBe(sq2)
  })

  it('pushMessage 后 controller 未关闭', () => {
    const fakeQuery = makeFakeQuery()
    const mgr = new SessionQueryManager()
    const wc = {} as WebContents
    mgr.ensureSession({ localSessionId: 's1', webContents: wc, onEvent: () => {}, onError: () => {}, buildQuery: () => fakeQuery as any })
    mgr.pushMessage('s1', 'hello')
    expect(mgr.sessions.get('s1')!.controller.isClosed()).toBe(false)
  })

  it('interrupt 调用 query.interrupt', async () => {
    const fakeQuery = makeFakeQuery()
    const mgr = new SessionQueryManager()
    const wc = {} as WebContents
    mgr.ensureSession({ localSessionId: 's1', webContents: wc, onEvent: () => {}, onError: () => {}, buildQuery: () => fakeQuery as any })
    await mgr.interrupt('s1')
    expect(fakeQuery._interruptCalled()).toBe(true)
  })

  it('interrupt 不存在的 session 不抛错', async () => {
    const mgr = new SessionQueryManager()
    await expect(mgr.interrupt('nope')).resolves.toBeUndefined()
  })

  it('closeSession 调用 query.return 并删除 session', async () => {
    const fakeQuery = makeFakeQuery()
    const mgr = new SessionQueryManager()
    const wc = {} as WebContents
    mgr.ensureSession({ localSessionId: 's1', webContents: wc, onEvent: () => {}, onError: () => {}, buildQuery: () => fakeQuery as any })
    await mgr.closeSession('s1')
    expect(fakeQuery._returnCalled()).toBe(true)
    expect(mgr.sessions.has('s1')).toBe(false)
  })

  it('closeAll 关闭所有 session', async () => {
    const queries: any[] = []
    const mgr = new SessionQueryManager()
    const wc = {} as WebContents
    const buildQuery = () => { const f = makeFakeQuery(); queries.push(f); return f as any }
    mgr.ensureSession({ localSessionId: 's1', webContents: wc, onEvent: () => {}, onError: () => {}, buildQuery })
    mgr.ensureSession({ localSessionId: 's2', webContents: wc, onEvent: () => {}, onError: () => {}, buildQuery })
    await mgr.closeAll()
    expect(mgr.sessions.size).toBe(0)
    expect(queries.every(q => q._returnCalled())).toBe(true)
  })

  it('stopTask 调用 query.stopTask', async () => {
    const fakeQuery = makeFakeQuery()
    let stoppedTask: string | null = null
    fakeQuery.stopTask = async (id: string) => { stoppedTask = id }
    const mgr = new SessionQueryManager()
    const wc = {} as WebContents
    mgr.ensureSession({ localSessionId: 's1', webContents: wc, onEvent: () => {}, onError: () => {}, buildQuery: () => fakeQuery as any })
    await mgr.stopTask('s1', 'task_xyz')
    expect(stoppedTask).toBe('task_xyz')
  })
})
