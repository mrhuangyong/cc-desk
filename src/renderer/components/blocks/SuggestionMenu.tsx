// src/renderer/components/blocks/SuggestionMenu.tsx
// 通用 suggestion 浮层：/ 和 @ 共用。
// 用 React Portal 定位到光标 clientRect 上方。
import { createPortal } from 'react-dom'
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

interface Props<T> {
  items: T[]
  selectedIndex: number
  clientRect: (() => DOMRect | null) | null
  renderItem: (item: T, selected: boolean) => ReactNode
  emptyHint?: string
  footer?: ReactNode              // 如「…还有 N 项」
  onSelectIdx: (idx: number) => void   // 鼠标点击确认
  onHover: (idx: number) => void       // 鼠标 hover 改选中
}

export function SuggestionMenu<T>({
  items, selectedIndex, clientRect, renderItem, emptyHint, footer, onSelectIdx, onHover,
}: Props<T>) {
  const rect = clientRect?.() ?? null
  // 选中项滚动入视图：键盘 ↑↓ 时选中项可能超出浮层可视区，自动滚进。
  const itemRefs = useRef<Array<HTMLDivElement | null>>([])
  useEffect(() => {
    const el = itemRefs.current[selectedIndex]
    // block:'nearest' 避免不必要的滚动，仅当选中项不在可视区时才滚
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])
  if (!rect) return null
  const top = rect.top
  const left = rect.left
  return createPortal(
    <div style={{
      position: 'fixed', top, left, transform: 'translateY(-100%)',
      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
      borderRadius: 10, boxShadow: 'var(--shadow-float)',
      padding: 5, minWidth: 220, maxHeight: 280, overflowY: 'auto', zIndex: 1000,
    }}>
      {items.length === 0 && (
        <div style={{ padding: '8px 10px', color: 'var(--text-muted)', fontSize: 12 }}>{emptyHint ?? '无匹配项'}</div>
      )}
      {items.map((item, i) => (
        <div
          key={i}
          ref={el => { itemRefs.current[i] = el }}
          onMouseEnter={() => onHover(i)}
          onClick={() => onSelectIdx(i)}
          style={{
            padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
            background: i === selectedIndex ? 'var(--bg-hover)' : 'transparent',
            display: 'flex', alignItems: 'center', gap: 8,
          }}
        >
          {renderItem(item, i === selectedIndex)}
        </div>
      ))}
      {footer}
    </div>,
    document.body,
  )
}
