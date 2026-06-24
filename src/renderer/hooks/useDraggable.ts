import { useCallback, useEffect, useRef, useState } from 'react'

export interface Position {
  x: number
  y: number
}

interface Options {
  initial: Position
  onChange?: (pos: Position) => void
  /** 被拖动元素尺寸，用于 clamp 不超出视口；size 变化时自动重 clamp（见 anchor） */
  size: { width: number; height: number }
  /** 视口安全边距 */
  margin?: number
  /**
   * position 的语义锚点：
   * - 'top-left'（默认）：position = 元素左上角，translate(position.x, position.y)。
   * - 'top-right'：position = 元素右上角，translate(position.x - width, position.y)。
   *   折叠/展开宽度变化时，元素右上角固定、向左下伸缩，clamp 按右上角算边界。
   */
  anchor?: 'top-left' | 'top-right'
}

const DRAG_THRESHOLD = 3

/**
 * 通用 pointer 拖动 hook。拖动期用 ref + 直接改 DOM transform 跟手（绕过逐帧渲染），
 * pointerup 时同步 React state 并触发 onChange。位移 < 3px 视为点击（不更新位置）。
 * 参考 useResizableWidth 的模式。jsdom 无 PointerEvent 时降级为 MouseEvent。
 */
export function useDraggable({ initial, onChange, size, margin = 8, anchor = 'top-left' }: Options) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPositionState] = useState<Position>(initial)
  const [dragging, setDragging] = useState(false)

  // 拖动期 ref（不触发渲染）
  const startPointer = useRef<Position | null>(null) // pointerdown 时的指针坐标
  const startPos = useRef<Position>(initial) // pointerdown 时的元素位置
  const moved = useRef(false) // 是否超过阈值
  const rafRef = useRef(0)

  const clamp = useCallback(
    (p: Position): Position => {
      // top-right 锚点：p.x 是右边缘，需保证 p.x ≤ innerWidth - margin 且 p.x - width ≥ margin
      // top-left 锚点：p.x 是左边缘，需保证 p.x ≥ margin 且 p.x + width ≤ innerWidth - margin
      const maxX = anchor === 'top-right' ? window.innerWidth - margin : window.innerWidth - size.width - margin
      const minX = anchor === 'top-right' ? size.width + margin : margin
      // 下边界用元素【真实渲染高度】而非传入的 size.height：悬浮面板内容可变，
      // size.height 硬编码会导致内容少时按虚拟大高度算 maxY，面板被限制在视口上半部、
      // 拖不到下方。读 offsetHeight 拿真实高度，内容少即可拖到更下方，内容多也不溢出。
      const realHeight = ref.current?.offsetHeight ?? size.height
      const maxY = window.innerHeight - realHeight - margin
      return {
        x: Math.min(Math.max(p.x, minX), Math.max(minX, maxX)),
        y: Math.min(Math.max(p.y, margin), Math.max(margin, maxY)),
      }
    },
    [size.width, size.height, margin, anchor],
  )

  const applyTransform = useCallback((p: Position) => {
    const el = ref.current
    if (!el) return
    // top-right 锚点：元素右上角对齐 p.x，故 translate.x = p.x - width
    const tx = anchor === 'top-right' ? p.x - size.width : p.x
    el.style.transform = `translate(${tx}px, ${p.y}px)`
  }, [anchor, size.width])

  const onPointerDown = useCallback(
    (e: React.PointerEvent | PointerEvent | { clientX: number; clientY: number }) => {
      startPointer.current = { x: (e as { clientX: number }).clientX, y: (e as { clientY: number }).clientY }
      startPos.current = position
      moved.current = false
      setDragging(true)
    },
    [position],
  )

  useEffect(() => {
    if (!dragging) return

    // 拖动期间记录最后一次 pointer 坐标，pointerup 时据此算最终位置
    const lastPointer: { current: Position | null } = { current: null }

    // onUp 需先于 onMove 声明：onMove 内部 buttons===0（已松手）时会调用 onUp
    const onUp = () => {
      cancelAnimationFrame(rafRef.current)
      setDragging(false)
      if (moved.current && startPointer.current) {
        // 计算最终位置（最后一次 move 的目标已写到 transform，但 state 还没更新）
        const dxLast = (lastPointer.current?.x ?? startPointer.current.x) - startPointer.current.x
        const dyLast = (lastPointer.current?.y ?? startPointer.current.y) - startPointer.current.y
        const finalPos = clamp({ x: startPos.current.x + dxLast, y: startPos.current.y + dyLast })
        setPositionState(finalPos)
        onChange?.(finalPos)
      }
      startPointer.current = null
      lastPointer.current = null
    }

    const onMove = (e: Event) => {
      const ev = e as PointerEvent
      if (startPointer.current == null) return
      // 防卡死：buttons===0 表示已松手（mouse 类事件）；PointerEvent 在 jsdom 也走这里
      if ('buttons' in ev && ev.buttons === 0) {
        onUp()
        return
      }
      const dx = ev.clientX - startPointer.current.x
      const dy = ev.clientY - startPointer.current.y
      if (!moved.current && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      moved.current = true
      const next = clamp({ x: startPos.current.x + dx, y: startPos.current.y + dy })
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => applyTransform(next))
    }

    // 包装 onMove 记录最后指针位置
    const onMoveWrapped = (e: Event) => {
      const ev = e as PointerEvent
      lastPointer.current = { x: ev.clientX, y: ev.clientY }
      onMove(e)
    }

    window.addEventListener('pointermove', onMoveWrapped as EventListener)
    window.addEventListener('pointerup', onUp as EventListener)
    window.addEventListener('pointercancel', onUp as EventListener)
    document.body.style.userSelect = 'none'
    return () => {
      window.removeEventListener('pointermove', onMoveWrapped as EventListener)
      window.removeEventListener('pointerup', onUp as EventListener)
      window.removeEventListener('pointercancel', onUp as EventListener)
      cancelAnimationFrame(rafRef.current)
      document.body.style.userSelect = ''
    }
  }, [dragging, clamp, applyTransform, onChange])

  // position 外部变更时同步 transform（如从 settings 恢复）
  useEffect(() => {
    applyTransform(position)
  }, [position, applyTransform])

  // size 变化时（如折叠↔展开）重新 clamp 当前位置，防止尺寸变大后溢出视口。
  // clamp 是 useCallback 依赖 [size.width, size.height, margin]，size 变 → clamp
  // 引用变 → 此 effect 跑。用函数式更新读最新 position，clamp 后若值变了会触发上面的
  // transform 同步 effect。
  useEffect(() => {
    setPositionState(prev => clamp(prev))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clamp])

  const setPosition = useCallback((p: Position) => {
    setPositionState(p)
  }, [])

  return { ref, position, dragging, onPointerDown, setPosition }
}
