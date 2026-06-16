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
 * 拖动期间监听 window 的 mousemove/mouseup，松手时持久化。
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
  // 拖动起点：鼠标 x 与当前宽度
  const startXRef = useRef(0)
  const startWidthRef = useRef(width)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    startXRef.current = e.clientX
    startWidthRef.current = width
    setDragging(true)
  }, [width])

  useEffect(() => {
    if (!dragging) return

    const onMove = (e: MouseEvent) => {
      const delta = e.clientX - startXRef.current
      // 手柄在左侧：鼠标右移(delta>0) → 宽度变小
      const next = side === 'left' ? startWidthRef.current - delta : startWidthRef.current + delta
      setWidth(Math.min(max, Math.max(min, next)))
    }
    const onUp = () => {
      setDragging(false)
      if (storageKey) {
        setWidth(w => {
          localStorage.setItem(storageKey, String(w))
          return w
        })
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [dragging, min, max, side, storageKey])

  return { width, dragging, onMouseDown }
}
