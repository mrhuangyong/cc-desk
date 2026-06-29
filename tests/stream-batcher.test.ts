import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStreamBatcher } from '../src/renderer/hooks/useStreamBatcher'

// 把 rAF 桩成同步可控:手动调用 queued callbacks
let rafCbs: FrameRequestCallback[] = []
let timeoutCbs: (() => void)[] = []

beforeEach(() => {
  rafCbs = []
  timeoutCbs = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { rafCbs.push(cb); return rafCbs.length })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('setTimeout', ((cb: () => void) => { timeoutCbs.push(cb); return timeoutCbs.length }) as any)
  vi.stubGlobal('clearTimeout', () => {})
})
afterEach(() => { vi.unstubAllGlobals() })

describe('useStreamBatcher', () => {
  it('同一帧内同 kind 的多次 pushDelta 合并成一次 dispatch', () => {
    const dispatch = vi.fn()
    const { result } = renderHook(() => useStreamBatcher(dispatch))
    act(() => {
      result.current.pushDelta('s1', 'text', '你')
      result.current.pushDelta('s1', 'text', '好')
      result.current.pushDelta('s1', 'text', '世')
      result.current.pushDelta('s1', 'text', '界')
    })
    // 还没 rAF,不应 dispatch
    expect(dispatch).not.toHaveBeenCalled()
    // 触发 rAF
    act(() => { rafCbs.forEach(cb => cb(0)) })
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({ type: 'STREAM_DELTA', sessionId: 's1', kind: 'text', delta: '你好世界' })
  })

  it('同一帧内 text 与 thinking 分别合并(不混)', () => {
    const dispatch = vi.fn()
    const { result } = renderHook(() => useStreamBatcher(dispatch))
    act(() => {
      result.current.pushDelta('s1', 'text', 'A')
      result.current.pushDelta('s1', 'thinking', 'B')
      result.current.pushDelta('s1', 'text', 'C')
    })
    act(() => { rafCbs.forEach(cb => cb(0)) })
    expect(dispatch).toHaveBeenCalledTimes(2)
    const calls = dispatch.mock.calls.map(c => c[0])
    const textCall = calls.find((c: any) => c.kind === 'text')
    const thinkCall = calls.find((c: any) => c.kind === 'thinking')
    expect(textCall.delta).toBe('AC')
    expect(thinkCall.delta).toBe('B')
  })

  it('flush 立即同步派发 buffer(中断兜底,不丢末尾)', () => {
    const dispatch = vi.fn()
    const { result } = renderHook(() => useStreamBatcher(dispatch))
    act(() => { result.current.pushDelta('s1', 'text', '尾') })
    expect(dispatch).not.toHaveBeenCalled()
    act(() => { result.current.flush() })
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({ type: 'STREAM_DELTA', sessionId: 's1', kind: 'text', delta: '尾' })
  })

  it('不同 sessionId 的 buffer 互不干扰', () => {
    const dispatch = vi.fn()
    const { result } = renderHook(() => useStreamBatcher(dispatch))
    act(() => {
      result.current.pushDelta('s1', 'text', 'A')
      result.current.pushDelta('s2', 'text', 'B')
    })
    act(() => { rafCbs.forEach(cb => cb(0)) })
    const calls = dispatch.mock.calls.map(c => c[0])
    expect(calls).toContainEqual({ type: 'STREAM_DELTA', sessionId: 's1', kind: 'text', delta: 'A' })
    expect(calls).toContainEqual({ type: 'STREAM_DELTA', sessionId: 's2', kind: 'text', delta: 'B' })
  })

  it('flush 后 buffer 清空(不重复派发)', () => {
    const dispatch = vi.fn()
    const { result } = renderHook(() => useStreamBatcher(dispatch))
    act(() => { result.current.pushDelta('s1', 'text', 'X') })
    act(() => { result.current.flush() })
    act(() => { rafCbs.forEach(cb => cb(0)) })
    expect(dispatch).toHaveBeenCalledTimes(1)
  })
})
