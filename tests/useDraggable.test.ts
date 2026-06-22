import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDraggable } from '../src/renderer/hooks/useDraggable'

// 测试说明：jsdom 可能未注册全局 PointerEvent 构造函数，统一用 MouseEvent
// + 'pointermove'/'pointerup' 事件名（addEventListener 监听的是字符串事件名，
// dispatch 的 Event 子类不影响）。pointermove 事件带 buttons:1 模拟真实按下态
// 指针（真实 PointerEvent 在按键按下时 buttons 非 0），否则 hook 的防卡死分支
// （buttons===0 视为已松手）会误提前结束拖动。
describe('useDraggable', () => {
  beforeEach(() => {
    // jsdom 内部尺寸默认 1024×768
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1024 })
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 768 })
  })

  it('初始位置 = initial，未拖动', () => {
    const { result } = renderHook(() => useDraggable({ initial: { x: 100, y: 50 }, size: { width: 36, height: 36 } }))
    expect(result.current.position).toEqual({ x: 100, y: 50 })
    expect(result.current.dragging).toBe(false)
  })

  it('setPosition 更新位置', () => {
    const { result } = renderHook(() => useDraggable({ initial: { x: 0, y: 0 }, size: { width: 36, height: 36 } }))
    act(() => result.current.setPosition({ x: 200, y: 100 }))
    expect(result.current.position).toEqual({ x: 200, y: 100 })
  })

  it('拖动超过阈值更新位置并触发 onChange', () => {
    const onChange = vi.fn()
    const { result } = renderHook(() => useDraggable({ initial: { x: 100, y: 100 }, size: { width: 36, height: 36 }, onChange }))
    // 模拟 pointer 序列：down → move(位移 50) → up
    // jsdom 可能未注册全局 PointerEvent，统一用 MouseEvent + 'pointermove'/'pointerup' 事件名
    act(() => {
      result.current.onPointerDown({ clientX: 100, clientY: 100 } as any)
    })
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 150, clientY: 100, buttons: 1 }))
    })
    act(() => {
      window.dispatchEvent(new MouseEvent('pointerup', { clientX: 150, clientY: 100 }))
    })
    expect(result.current.dragging).toBe(false)
    // 位置应从 100 移到 150
    expect(result.current.position.x).toBe(150)
    expect(onChange).toHaveBeenCalledWith({ x: 150, y: 100 })
  })

  it('位移小于阈值不更新位置（视为点击）', () => {
    const onChange = vi.fn()
    const { result } = renderHook(() => useDraggable({ initial: { x: 100, y: 100 }, size: { width: 36, height: 36 }, onChange }))
    act(() => result.current.onPointerDown({ clientX: 100, clientY: 100 } as any))
    act(() => window.dispatchEvent(new MouseEvent('pointermove', { clientX: 102, clientY: 101, buttons: 1 })))
    act(() => window.dispatchEvent(new MouseEvent('pointerup', { clientX: 102, clientY: 101 })))
    expect(result.current.position).toEqual({ x: 100, y: 100 })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('clamp 到视口内（不超出边界）', () => {
    const { result } = renderHook(() => useDraggable({ initial: { x: 0, y: 0 }, size: { width: 36, height: 36 }, margin: 8 }))
    act(() => result.current.onPointerDown({ clientX: 0, clientY: 0 } as any))
    // 往左上拖到负坐标
    act(() => window.dispatchEvent(new MouseEvent('pointermove', { clientX: -500, clientY: -500, buttons: 1 })))
    act(() => window.dispatchEvent(new MouseEvent('pointerup', { clientX: -500, clientY: -500 })))
    // 应 clamp 到 margin=8
    expect(result.current.position.x).toBe(8)
    expect(result.current.position.y).toBe(8)
  })
})
