// web/src/hooks/useDialogQueue.test.tsx
// useDialogQueue 的 React 集成测试（Task 14）。
//
// 关注：收到 dialog.request 信封入队、当前请求展示、批准/拒绝/忽略 → 发 dialog.response。
// 传输隔离：send 用 mock（不连真实中继，符合"纯逻辑 + 协议契约"层）。
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, render, screen } from '@testing-library/react'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { useDialogQueue } from './useDialogQueue'
import type { Envelope } from '@shared/remote-protocol-types'

const mkDialogEnv = (reqId: string): Envelope => ({
  v: 1,
  type: 'dialog.request',
  deviceId: 'desk',
  ts: 1,
  nonce: 'n',
  sig: '',
  payload: { reqId, localSessionId: 's1', dialogKind: 'plan_proposed', payload: { question: '允许吗?' } },
})

describe('useDialogQueue - 入队', () => {
  it('初始为空', () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useDialogQueue({ send }))
    expect(result.current.current).toBeNull()
    expect(result.current.items).toHaveLength(0)
  })

  it('收到 dialog.request 信封入队，current = 队首', () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useDialogQueue({ send }))
    act(() => {
      result.current.onInbound(mkDialogEnv('r1'))
    })
    expect(result.current.current?.reqId).toBe('r1')
  })

  it('多条 FIFO 入队，current 始终队首', () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useDialogQueue({ send }))
    act(() => {
      result.current.onInbound(mkDialogEnv('r1'))
      result.current.onInbound(mkDialogEnv('r2'))
    })
    expect(result.current.items.map((d) => d.reqId)).toEqual(['r1', 'r2'])
    expect(result.current.current?.reqId).toBe('r1')
  })

  it('同 reqId 去重（断线补发不重复）', () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useDialogQueue({ send }))
    act(() => {
      result.current.onInbound(mkDialogEnv('r1'))
      result.current.onInbound(mkDialogEnv('r1'))
    })
    expect(result.current.items).toHaveLength(1)
  })

  it('非 dialog.request 信封被忽略', () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useDialogQueue({ send }))
    act(() => {
      result.current.onInbound({ ...mkDialogEnv('r1'), type: 'session.delta' })
    })
    expect(result.current.items).toHaveLength(0)
  })
})

describe('useDialogQueue - resolve（批准/拒绝）', () => {
  it('approve 发 dialog.response，result 按 dialogKind 构造（plan→completed+permissionMode），并移出队列', async () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useDialogQueue({ send }))
    act(() => {
      result.current.onInbound(mkDialogEnv('r1'))
    })
    await act(async () => {
      await result.current.approve('r1')
    })
    expect(send).toHaveBeenCalledWith('dialog.response', {
      reqId: 'r1',
      result: { behavior: 'completed', result: { permissionMode: '自动编辑' } },
    })
    expect(result.current.items).toHaveLength(0)
  })

  it('deny 发 dialog.response，result=deny', async () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useDialogQueue({ send }))
    act(() => {
      result.current.onInbound(mkDialogEnv('r1'))
    })
    await act(async () => {
      await result.current.deny('r1')
    })
    expect(send).toHaveBeenCalledWith('dialog.response', {
      reqId: 'r1',
      result: { behavior: 'deny' },
    })
    expect(result.current.items).toHaveLength(0)
  })

  it('permission_request 批准 → result=completed（不带 autoAllow）', async () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useDialogQueue({ send }))
    act(() => {
      result.current.onInbound({
        ...mkDialogEnv('r1'),
        payload: { reqId: 'r1', localSessionId: 's1', dialogKind: 'permission_request', payload: {} },
      })
    })
    await act(async () => {
      await result.current.approve('r1')
    })
    expect(send).toHaveBeenCalledWith('dialog.response', {
      reqId: 'r1',
      result: { behavior: 'completed' },
    })
  })

  it('ask_user_question 批准透传 opts.answers → result 含 answers（非 cancelled）', async () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useDialogQueue({ send }))
    act(() => {
      result.current.onInbound({
        ...mkDialogEnv('r1'),
        payload: { reqId: 'r1', localSessionId: 's1', dialogKind: 'ask_user_question', payload: { questions: [] } },
      })
    })
    const answers = [{ questionIndex: 0, selected: { index: 1, label: 'x' } }]
    await act(async () => {
      await result.current.approve('r1', { answers })
    })
    expect(send).toHaveBeenCalledWith('dialog.response', {
      reqId: 'r1',
      result: { behavior: 'completed', result: { answers } },
    })
  })

  it('plan_proposed 批准透传 opts.permissionMode → result 用选定模式', async () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useDialogQueue({ send }))
    act(() => {
      result.current.onInbound(mkDialogEnv('r1')) // plan_proposed
    })
    await act(async () => {
      await result.current.approve('r1', { permissionMode: '完全访问' })
    })
    expect(send).toHaveBeenCalledWith('dialog.response', {
      reqId: 'r1',
      result: { behavior: 'completed', result: { permissionMode: '完全访问' } },
    })
  })

  it('send 失败（未连接）时保留队列项，不移除', async () => {
    // I1：useRelay.send 未连接时返回 false（静默丢弃）。断线时点批准不应让卡片消失。
    const send = vi.fn().mockResolvedValue(false)
    const { result } = renderHook(() => useDialogQueue({ send }))
    act(() => {
      result.current.onInbound(mkDialogEnv('r1'))
    })
    await act(async () => {
      await result.current.approve('r1')
    })
    expect(send).toHaveBeenCalledTimes(1)
    expect(result.current.items).toHaveLength(1)
    expect(result.current.current?.reqId).toBe('r1')
  })

  it('解决 current 后下一条成为 current', async () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useDialogQueue({ send }))
    act(() => {
      result.current.onInbound(mkDialogEnv('r1'))
      result.current.onInbound(mkDialogEnv('r2'))
    })
    await act(async () => {
      await result.current.approve('r1')
    })
    expect(result.current.current?.reqId).toBe('r2')
  })
})

describe('useDialogQueue - ignore', () => {
  it('ignore 不发 dialog.response，但移出队列', () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useDialogQueue({ send }))
    act(() => {
      result.current.onInbound(mkDialogEnv('r1'))
    })
    act(() => {
      result.current.ignore('r1')
    })
    expect(send).not.toHaveBeenCalled()
    expect(result.current.items).toHaveLength(0)
  })
})

describe('useDialogQueue - clear', () => {
  it('清空全部', () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useDialogQueue({ send }))
    act(() => {
      result.current.onInbound(mkDialogEnv('r1'))
      result.current.onInbound(mkDialogEnv('r2'))
      result.current.clear()
    })
    expect(result.current.items).toHaveLength(0)
  })
})
