// src/renderer/components/blocks/SuggestionMenu.tsx
// 通用 suggestion 浮层：/ 和 @ 共用。
// 用 React Portal 定位到光标 clientRect 上方。
// 可选 groupKey：相同 groupKey 的连续项归为一组，组间插分隔线（可带组标题）。
import { createPortal } from 'react-dom'
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

interface Props<T> {
  items: T[]
  selectedIndex: number
  clientRect: (() => DOMRect | null) | null
  renderItem: (item: T, selected: boolean) => ReactNode
  emptyHint?: string
  footer?: ReactNode
  onSelectIdx: (idx: number) => void
  onHover: (idx: number) => void
  groupKey?: (item: T) => string                  // 分组键（如 item.kind）
  groupLabel?: (key: string) => ReactNode | null  // 组标题（返回 null 则只画分隔线）
}

export function SuggestionMenu<T>({
  items, selectedIndex, clientRect, renderItem, emptyHint, footer, onSelectIdx, onHover, groupKey, groupLabel,
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

  // 渲染项列表（含组分隔线）。分隔线不占 itemRefs 索引——索引仍按原 items 顺序。
  const rendered: ReactNode[] = []
  let prevGroup: string | undefined
  items.forEach((item, i) => {
    const g = groupKey?.(item)
    if (g !== prevGroup && groupKey && g !== undefined) {
      const label = groupLabel?.(g as string) ?? null
      rendered.push(
        <div key={`sep-${g}`} style={{
          margin: '4px 0 2px', padding: '2px 10px',
          borderTop: i === 0 ? 'none' : '1px solid var(--border)',
          fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: 0.5,
        }}>{label}</div>,
      )
      prevGroup = g
    }
    rendered.push(
      <div
        key={`item-${i}`}
        ref={el => { itemRefs.current[i] = el }}
        // 浮层经 Portal 挂在 body，点选项时若不禁止 mousedown 默认行为，
        // 焦点会从编辑器移走 → suggestion 检测失焦触发 onExit 把 command 置空，
        // 随后的 click 里 onSelectIdx 的 `if (command && items[i])` 判空失败，命令填不进去。
        onMouseDown={(e) => e.preventDefault()}
        onMouseEnter={() => onHover(i)}
        onClick={() => onSelectIdx(i)}
        style={{
          padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
          background: i === selectedIndex ? 'var(--bg-hover)' : 'transparent',
          display: 'flex', alignItems: 'center', gap: 8,
        }}
      >
        {renderItem(item, i === selectedIndex)}
      </div>,
    )
  })

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
      {rendered}
      {footer}
    </div>,
    document.body,
  )
}
