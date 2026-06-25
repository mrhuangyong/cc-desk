// web/src/lib/dialog-queue.test.ts
// useDialogQueue 的纯逻辑测试（Task 14）。
//
// 关注：dialog.request 入队、按 reqId 去重、FIFO 出队、解决/取消/忽略、断线补发顺序。
// 传输（send）与 React 集成在 useDialogQueue.test.tsx 里测。
import { describe, it, expect } from 'vitest'
import {
  type DialogRequest,
  createDialogQueue,
} from './dialog-queue'

const mkReq = (reqId: string, ts = 0): DialogRequest => ({
  reqId,
  localSessionId: 's1',
  dialogKind: 'plan_proposed',
  payload: { ts },
})

describe('createDialogQueue - enqueue', () => {
  it('空队列入队一条', () => {
    const q = createDialogQueue()
    const { items, current } = q.enqueue(mkReq('r1'))
    expect(items).toHaveLength(1)
    expect(current?.reqId).toBe('r1')
  })

  it('FIFO 顺序：current 总是队首', () => {
    const q = createDialogQueue()
    let { items, current } = q.enqueue(mkReq('r1', 1))
    ;({ items, current } = q.enqueue(mkReq('r2', 2)))
    expect(items.map((d) => d.reqId)).toEqual(['r1', 'r2'])
    expect(current?.reqId).toBe('r1')
  })

  it('同 reqId 入队去重（不重复展示）', () => {
    const q = createDialogQueue()
    q.enqueue(mkReq('r1', 1))
    const { items } = q.enqueue(mkReq('r1', 2)) // 断线补发同一条
    expect(items).toHaveLength(1)
  })

  it('同 reqId 补发不污染原顺序（保留首次位置）', () => {
    const q = createDialogQueue()
    q.enqueue(mkReq('r1', 1))
    q.enqueue(mkReq('r2', 2))
    const { items } = q.enqueue(mkReq('r1', 3)) // 补发 r1
    expect(items.map((d) => d.reqId)).toEqual(['r1', 'r2'])
  })
})

describe('createDialogQueue - resolve', () => {
  it('解决 current 后队首出队，下一条成为 current', () => {
    const q = createDialogQueue()
    q.enqueue(mkReq('r1', 1))
    q.enqueue(mkReq('r2', 2))
    const { items, current } = q.resolve('r1')
    expect(items.map((d) => d.reqId)).toEqual(['r2'])
    expect(current?.reqId).toBe('r2')
  })

  it('解决非队首 reqId 也从队列移除（断线/乱序）', () => {
    const q = createDialogQueue()
    q.enqueue(mkReq('r1', 1))
    q.enqueue(mkReq('r2', 2))
    q.enqueue(mkReq('r3', 3))
    const { items } = q.resolve('r2')
    expect(items.map((d) => d.reqId)).toEqual(['r1', 'r3'])
  })

  it('解决不存在的 reqId 无副作用', () => {
    const q = createDialogQueue()
    q.enqueue(mkReq('r1'))
    const { items } = q.resolve('nope')
    expect(items.map((d) => d.reqId)).toEqual(['r1'])
  })

  it('空队列 resolve 安全（无异常）', () => {
    const q = createDialogQueue()
    expect(() => q.resolve('x')).not.toThrow()
  })
})

describe('createDialogQueue - ignore', () => {
  it('忽略 = 不解决但移出队列（不计入已处理）', () => {
    const q = createDialogQueue()
    q.enqueue(mkReq('r1'))
    q.enqueue(mkReq('r2'))
    const { items, current } = q.ignore('r1')
    expect(items.map((d) => d.reqId)).toEqual(['r2'])
    expect(current?.reqId).toBe('r2')
  })
})

describe('createDialogQueue - 多次 enqueue 后 resolve 全部', () => {
  it('逐条解决至空', () => {
    const q = createDialogQueue()
    q.enqueue(mkReq('r1'))
    q.enqueue(mkReq('r2'))
    q.enqueue(mkReq('r3'))
    let st = q.resolve('r1')
    st = q.resolve('r2')
    st = q.resolve('r3')
    expect(st.items).toHaveLength(0)
    expect(st.current).toBeNull()
  })
})
