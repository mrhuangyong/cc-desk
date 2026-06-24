import { useCallback, useEffect, useRef, useState } from 'react'

interface Options {
  /** 初始宽度 */
  initial: number
  /** 最小宽度 */
  min: number
  /** 最大宽度 */
  max: number
  /** 持久化 key，给 localStorage；不传则不持久化 */
  storageKey?: string
  /**
   * 拖动方向：
   * 'left'  —— 手柄在面板左侧，鼠标右移宽度变小（右栏）
   * 'right' —— 手柄在面板右侧，鼠标右移宽度变大（左栏，预留）
   */
  side: 'left' | 'right'
}

/**
 * 拖拽调节宽度。返回当前宽度、是否正在拖拽、手柄的 onPointerDown。
 * 拖拽期间用 ref + rAF 直接更新 DOM，松手时才同步 React state，避免重渲染延迟导致不跟手。
 *
 * 事件模型：Pointer Events + setPointerCapture。pointerdown 时捕获指针，
 * 后续 pointermove/pointerup 都【可靠派发】到手柄元素——即使鼠标快速移动或
 * 移出窗口也不丢事件。旧版用 mousemove + window 监听 + buttons===0/mouseleave
 * 兜底，在 Electron 快速拖动 / 鼠标甩出窗口边缘时 mouseup 仍会丢失，导致
 * dragging 卡在 true、window mousemove 残留，表现为「不按键移到边框也进入
 * 拖动、只能动一点点」。setPointerCapture 从根本上消除事件丢失。
 */
export function useResizableWidth({ initial, min, max, storageKey, side }: Options) {
  const [width, setWidth] = useState<number>(() => {
    if (storageKey) {
      const saved = Number(localStorage.getItem(storageKey))
      if (!Number.isNaN(saved) && saved >= min && saved <= max) return saved
    }
    return initial
  })
  const [dragging, setDragging] = useState(false)

  // 拖拽期间用 ref 跟踪，避免 setState 逐帧重渲染
  const widthRef = useRef(width)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)
  const rafRef = useRef(0)
  // 暴露给外部的回调，由 effect 注册到 DOM 元素上
  const applyWidthRef = useRef<((w: number) => void) | null>(null)

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // 仅响应主键（左键），忽略右键/中键
    if (e.button !== 0) return
    e.preventDefault()
    // 捕获指针：把后续 pointer 事件锁定到当前元素，快速移动/移出窗口也不丢。
    // setPointerCapture 后，pointerup 即使在窗口外也会派发到本元素 → onUp 必然触发。
    const el = e.currentTarget as HTMLElement
    try { el.setPointerCapture(e.pointerId) } catch { /* 部分环境无此 API，降级到 window 监听（见 effect） */ }
    startXRef.current = e.clientX
    startWidthRef.current = widthRef.current
    setDragging(true)
  }, [])

  /** 注册：外部传入一个直接操作 DOM 宽度的函数 */
  const registerApply = useCallback((fn: (w: number) => void) => {
    applyWidthRef.current = fn
  }, [])

  useEffect(() => {
    if (!dragging) return

    const onMove = (e: PointerEvent) => {
      // 防御：buttons===0 表示已无按键（某些边缘场景 pointerup 漏掉时的兜底），主动结束。
      if (e.buttons === 0) {
        onUp()
        return
      }
      const delta = e.clientX - startXRef.current
      const next = side === 'left'
        ? startWidthRef.current - delta
        : startWidthRef.current + delta
      const clamped = Math.min(max, Math.max(min, next))
      widthRef.current = clamped

      // 用 rAF 批量更新 DOM，避免每帧多次重渲染
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        applyWidthRef.current?.(clamped)
      })
    }

    const onUp = () => {
      cancelAnimationFrame(rafRef.current)
      setDragging(false)
      // 松手时同步 state + 持久化
      const final = widthRef.current
      setWidth(final)
      if (storageKey) localStorage.setItem(storageKey, String(final))
    }

    // pointer capture 下 pointermove/pointerup 直接到手柄元素；
    // 同时在 window 上兜底监听，确保任何路径下都能结束拖动。
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [dragging, min, max, side, storageKey])

  // state 变化时同步 ref
  useEffect(() => { widthRef.current = width }, [width])

  return { width, dragging, onPointerDown, registerApply }
}
