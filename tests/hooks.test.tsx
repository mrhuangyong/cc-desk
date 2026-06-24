// Hooks 测试：useTheme（主题应用+持久化）、useResizableWidth（拖拽调宽+clamp+持久化）。
// 这是真实 UI 功能：主题切换、可拖拽面板宽度。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

let mockState: any
const dispatch = vi.fn()
vi.mock('../src/renderer/state/store', () => ({
  useStore: () => ({ state: mockState, dispatch }),
}))

import { useTheme } from '../src/renderer/hooks/useTheme'
import { useResizableWidth } from '../src/renderer/hooks/useResizableWidth'
import { usePanelAnimation } from '../src/renderer/hooks/usePanelAnimation'

describe('useTheme', () => {
  beforeEach(() => {
    dispatch.mockClear()
    mockState = { theme: 'codex-dark' }
    ;(window as any).api = { settings: { save: vi.fn() } }
    localStorage.clear()
  })

  it('effect 应用 data-theme 到 document + localStorage', () => {
    renderHook(() => useTheme())
    expect(document.documentElement.getAttribute('data-theme')).toBe('codex-dark')
    expect(localStorage.getItem('cc-desk-theme')).toBe('codex-dark')
  })

  it('setTheme → dispatch SET_THEME + api.settings.save', () => {
    const { result } = renderHook(() => useTheme())
    act(() => result.current.setTheme('codex-light'))
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_THEME', theme: 'codex-light' })
    expect((window as any).api.settings.save).toHaveBeenCalledWith({ theme: 'codex-light' })
  })
})

describe('useResizableWidth', () => {
  beforeEach(() => {
    localStorage.clear()
    // jsdom 默认无 requestAnimationFrame
    ;(window as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
      return setTimeout(() => cb(0), 0) as unknown as number
    }
    ;(window as any).cancelAnimationFrame = (id: number) => clearTimeout(id)
  })
  afterEach(() => vi.restoreAllMocks())

  it('初始宽度用 initial（无 storageKey）', () => {
    const { result } = renderHook(() => useResizableWidth({ initial: 300, min: 100, max: 500, side: 'left' }))
    expect(result.current.width).toBe(300)
    expect(result.current.dragging).toBe(false)
  })

  it('localStorage 有效值 → 恢复', () => {
    localStorage.setItem('panel-w', '250')
    const { result } = renderHook(() => useResizableWidth({ initial: 300, min: 100, max: 500, side: 'left', storageKey: 'panel-w' }))
    expect(result.current.width).toBe(250)
  })

  it('localStorage 越界值 → 回退 initial（clamp 守护）', () => {
    localStorage.setItem('panel-w', '9999')  // 超过 max
    const { result } = renderHook(() => useResizableWidth({ initial: 300, min: 100, max: 500, side: 'left', storageKey: 'panel-w' }))
    expect(result.current.width).toBe(300)
  })

  it('onPointerDown 进入 dragging 态', () => {
    const { result } = renderHook(() => useResizableWidth({ initial: 300, min: 100, max: 500, side: 'left' }))
    act(() => {
      result.current.onPointerDown({ preventDefault: () => {}, button: 0, pointerId: 1, clientX: 100, currentTarget: { setPointerCapture: () => {} } } as any)
    })
    expect(result.current.dragging).toBe(true)
  })

  it('side=left：鼠标右移 → 宽度变小（delta 反向），并 clamp 到 [min,max]', async () => {
    const applySpy = vi.fn()
    const { result } = renderHook(() => useResizableWidth({ initial: 300, min: 100, max: 500, side: 'left' }))
    act(() => {
      result.current.registerApply(applySpy)
      result.current.onPointerDown({ preventDefault: () => {}, button: 0, pointerId: 1, clientX: 100, currentTarget: { setPointerCapture: () => {} } } as any)
    })
    // 鼠标右移 50（clientX 100→150），side=left：next = startWidth - delta = 300 - 50 = 250
    await act(async () => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 150, buttons: 1 }))
      await new Promise(r => setTimeout(r, 10))
    })
    expect(applySpy).toHaveBeenCalledWith(250)
    // 松手
    await act(async () => {
      window.dispatchEvent(new PointerEvent('pointerup'))
    })
    expect(result.current.width).toBe(250)
  })

  it('side=right：鼠标右移 → 宽度变大', async () => {
    const applySpy = vi.fn()
    const { result } = renderHook(() => useResizableWidth({ initial: 300, min: 100, max: 500, side: 'right' }))
    act(() => {
      result.current.registerApply(applySpy)
      result.current.onPointerDown({ preventDefault: () => {}, button: 0, pointerId: 1, clientX: 100, currentTarget: { setPointerCapture: () => {} } } as any)
    })
    await act(async () => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 150, buttons: 1 }))
      await new Promise(r => setTimeout(r, 10))
    })
    expect(applySpy).toHaveBeenCalledWith(350)  // 300 + 50
  })

  it('拖拽超 max → clamp 到 max', async () => {
    const applySpy = vi.fn()
    const { result } = renderHook(() => useResizableWidth({ initial: 480, min: 100, max: 500, side: 'right' }))
    act(() => {
      result.current.registerApply(applySpy)
      result.current.onPointerDown({ preventDefault: () => {}, button: 0, pointerId: 1, clientX: 100, currentTarget: { setPointerCapture: () => {} } } as any)
    })
    await act(async () => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 500, buttons: 1 }))  // delta=400 → 880 → clamp 500
      await new Promise(r => setTimeout(r, 10))
    })
    expect(applySpy).toHaveBeenCalledWith(500)
  })

  it('松手后宽度持久化到 localStorage（有 storageKey）', async () => {
    const { result } = renderHook(() => useResizableWidth({ initial: 300, min: 100, max: 500, side: 'left', storageKey: 'pw' }))
    act(() => {
      result.current.onPointerDown({ preventDefault: () => {}, button: 0, pointerId: 1, clientX: 100, currentTarget: { setPointerCapture: () => {} } } as any)
    })
    await act(async () => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 150, buttons: 1 }))
      await new Promise(r => setTimeout(r, 10))
      window.dispatchEvent(new PointerEvent('pointerup'))
    })
    expect(localStorage.getItem('pw')).toBe('250')
  })

  it('pointerup 后 dragging 必为 false（pointer capture 保证松手可靠结束，不卡残留态）', async () => {
    const { result } = renderHook(() => useResizableWidth({ initial: 300, min: 100, max: 500, side: 'left' }))
    act(() => {
      result.current.onPointerDown({ preventDefault: () => {}, button: 0, pointerId: 1, clientX: 100, currentTarget: { setPointerCapture: () => {} } } as any)
    })
    expect(result.current.dragging).toBe(true)
    await act(async () => {
      window.dispatchEvent(new PointerEvent('pointerup'))
    })
    expect(result.current.dragging).toBe(false)
  })
})

describe('usePanelAnimation', () => {
  it('初始折叠时保持未挂载，避免隐藏右栏内容泄漏到 DOM', async () => {
    const { result } = renderHook(() => usePanelAnimation(true))

    expect(result.current.mounted).toBe(false)
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    expect(result.current.mounted).toBe(false)
    expect(result.current.animating).toBe(false)
    expect(result.current.styles).toEqual({})
  })
})
