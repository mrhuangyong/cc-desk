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
 * 拖拽调节宽度。返回当前宽度、是否正在拖拽、手柄的 onMouseDown。
 * 拖拽期间用 ref + rAF 直接更新 DOM，松手时才同步 React state，避免重渲染延迟导致不跟手。
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

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
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

    const onMove = (e: MouseEvent) => {
      // 鼠标快速划出窗口 / 切到其他应用时 mouseup 可能漏掉，
      // 此时 buttons===0（无按键）。主动结束拖动，避免卡在 dragging 态跟着鼠标跑、停不掉。
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

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    // 鼠标划出整个窗口后 mousemove/mouseup 都不再触发，拖动会卡死。
    // 离开文档时主动结束。
    const onLeave = () => onUp()
    document.addEventListener('mouseleave', onLeave)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.removeEventListener('mouseleave', onLeave)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [dragging, min, max, side, storageKey])

  // state 变化时同步 ref
  useEffect(() => { widthRef.current = width }, [width])

  return { width, dragging, onMouseDown, registerApply }
}
