// web/src/hooks/usePwaBack.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePwaBack } from './usePwaBack'

// 辅助：直接派发 popstate（jsdom 的 history.back 是异步且时序难控，直接派发事件最可靠）
function firePopState() {
  act(() => {
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
}

describe('usePwaBack - PWA 系统返回键接管', () => {
  let onNavigateBack: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onNavigateBack = vi.fn()
    window.history.replaceState(null, '')
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('进入内层视图时压入历史条目', () => {
    const { rerender } = renderHook(
      ({ inInner }) => usePwaBack({ inInnerView: inInner, onNavigateBack }),
      { initialProps: { inInner: false } },
    )
    const before = window.history.length
    rerender({ inInner: true })
    expect(window.history.length).toBe(before + 1)
  })

  it('内层视图按返回（popstate）→ 调 onNavigateBack 回外层，不退出', () => {
    const { rerender } = renderHook(
      ({ inInner }) => usePwaBack({ inInnerView: inInner, onNavigateBack }),
      { initialProps: { inInner: false } },
    )
    rerender({ inInner: true })
    firePopState()
    expect(onNavigateBack).toHaveBeenCalledTimes(1)
  })

  it('外层（list）首次返回 → 显示「再按一次」提示，不退出', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => usePwaBack({ inInnerView: false, onNavigateBack }))
    expect(result.current.showExitToast).toBe(false)
    firePopState()
    expect(result.current.showExitToast).toBe(true)
  })

  it('外层窗口内第二次返回 → 真退出（不再补历史 pushState）', () => {
    vi.useFakeTimers()
    const pushSpy = vi.spyOn(window.history, 'pushState')
    const { result } = renderHook(() => usePwaBack({ inInnerView: false, onNavigateBack }))
    firePopState() // 第一次：拦截 + 提示 + pushState 补历史
    const pushesAfterFirst = pushSpy.mock.calls.length
    expect(result.current.showExitToast).toBe(true)
    firePopState() // 第二次：放行退出，不再 pushState
    const pushesAfterSecond = pushSpy.mock.calls.length
    // 第二次没新增 pushState（退出分支不补历史）
    expect(pushesAfterSecond).toBe(pushesAfterFirst)
    // toast 消失（disarmExit）
    expect(result.current.showExitToast).toBe(false)
    pushSpy.mockRestore()
  })

  it('退出提示超时后失效，下次返回重新算第一次', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() =>
      usePwaBack({ inInnerView: false, onNavigateBack, exitConfirmMs: 2000 }),
    )
    firePopState()
    expect(result.current.showExitToast).toBe(true)
    act(() => vi.advanceTimersByTime(2100))
    expect(result.current.showExitToast).toBe(false)
    firePopState() // 再次：仍第一次语义
    expect(result.current.showExitToast).toBe(true)
  })

  it('从内层返回外层后，退出提示被取消', () => {
    vi.useFakeTimers()
    const { rerender, result } = renderHook(
      ({ inInner }) => usePwaBack({ inInnerView: inInner, onNavigateBack }),
      { initialProps: { inInner: false } },
    )
    // 外层先触发一次提示
    firePopState()
    expect(result.current.showExitToast).toBe(true)
    // 进入内层再返回（应用内导航）→ 提示应取消
    rerender({ inInner: true })
    firePopState()
    expect(onNavigateBack).toHaveBeenCalled()
    expect(result.current.showExitToast).toBe(false)
  })
})
