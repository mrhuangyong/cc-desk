import { useCallback, useRef } from 'react'
import { TabBar } from './TabBar'
import { useResizableWidth } from '../hooks/useResizableWidth'

interface Props {
  collapsed: boolean
}

export function RightPanel({ collapsed }: Props) {
  const { width, dragging, onMouseDown, registerApply } = useResizableWidth({
    initial: 420,
    min: 320,
    max: 1200,
    side: 'left'
    // 不传 storageKey：右栏宽度不持久化，每次展开恢复默认宽度
  })

  const panelRef = useRef<HTMLDivElement>(null)

  // 拖拽期间直接设置 DOM style.width，绕过 React 渲染
  const refCallback = useCallback((node: HTMLDivElement | null) => {
    (panelRef as React.MutableRefObject<HTMLDivElement | null>).current = node
    if (node) {
      registerApply((w: number) => { node.style.width = `${w}px` })
    }
  }, [registerApply])

  if (collapsed) return null

  return (
    <div
      ref={refCallback}
      style={{
        width, flexShrink: 0, position: 'relative', background: 'var(--bg)',
        borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column'
      }}
    >
      {/* 拖拽手柄：左边缘竖条 */}
      <div
        onMouseDown={onMouseDown}
        title="拖动调节宽度"
        style={{
          position: 'absolute', left: -3, top: 0, bottom: 0, width: 6,
          cursor: 'col-resize', zIndex: 10,
          background: dragging ? 'var(--accent)' : 'transparent',
          transition: dragging ? 'none' : 'background .15s'
        }}
      />
      <TabBar />
    </div>
  )
}
