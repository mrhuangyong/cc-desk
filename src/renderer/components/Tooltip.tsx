import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  /** 悬停时显示的文本；为空则不渲染（视为禁用） */
  label?: string
  /** 被包裹的触发元素（通常是图标按钮） */
  children: ReactNode
  /** 气泡相对触发元素的位置，默认下方居中 */
  placement?: 'bottom' | 'top'
  /** 鼠标移入到显示的延迟（ms） */
  showDelay?: number
}

// 轻量自定义 tooltip：用 portal 渲染到 body，
// 绕开 Electron 窗口拖拽区（-webkit-app-region: drag）会吞掉原生 title tooltip 的问题，
// 也不受父级 overflow:hidden 裁切。
export function Tooltip({ label, children, placement = 'bottom', showDelay = 400 }: Props) {
  const triggerRef = useRef<HTMLElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimers = () => {
    if (showTimer.current) { clearTimeout(showTimer.current); showTimer.current = null }
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null }
  }

  useEffect(() => clearTimers, [])

  const measure = () => {
    // 包裹层是 display:contents，自身无盒模型，getBoundingClientRect 返回 0；
    // 取它的第一个元素子节点（真正的触发元素，如图标按钮）来定位
    const el = triggerRef.current?.firstElementChild as HTMLElement | null
    if (!el) return
    const r = el.getBoundingClientRect()
    // 气泡宽度未知，先粗略居中，渲染后由 transform: translateX(-50%) 修正
    const left = r.left + r.width / 2
    const top = placement === 'bottom' ? r.bottom + 6 : r.top - 6
    setPos({ left, top })
  }

  const onEnter = () => {
    if (!label) return
    clearTimers()
    showTimer.current = setTimeout(() => {
      measure()
    }, showDelay)
  }
  const onLeave = () => {
    clearTimers()
    hideTimer.current = setTimeout(() => setPos(null), 80)
  }

  return (
    <span
      ref={triggerRef as React.RefObject<HTMLSpanElement>}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      // display:contents 让包裹层不参与布局，触发元素原位渲染、点击/样式不受影响
      style={{ display: 'contents' }}
    >
      {children}
      {pos && label && createPortal(
        <div
          role="tooltip"
          style={{
            position: 'fixed',
            left: pos.left,
            top: pos.top,
            transform: placement === 'bottom'
              ? 'translateX(-50%)'
              : 'translateX(-50%) translateY(-100%)',
            padding: '4px 8px',
            background: 'var(--text)',
            color: 'var(--bg)',
            fontSize: 11,
            lineHeight: 1.4,
            borderRadius: 6,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 99999,
            boxShadow: 'var(--shadow-float)',
            maxWidth: 320,
          }}
        >{label}</div>,
        document.body
      )}
    </span>
  )
}
