import { TabBar } from './TabBar'
import { useResizableWidth } from '../hooks/useResizableWidth'

interface Props {
  collapsed: boolean
}

export function RightPanel({ collapsed }: Props) {
  const { width, dragging, onMouseDown } = useResizableWidth({
    initial: 420,
    min: 320,
    max: 1200,
    side: 'left',
    storageKey: 'cc-desk-right-width'
  })

  if (collapsed) return null

  return (
    <div style={{
      width, flexShrink: 0, position: 'relative', background: 'var(--bg-elevated)',
      borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column'
    }}>
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
