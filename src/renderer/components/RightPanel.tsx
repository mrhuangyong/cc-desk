import { useCallback, useRef } from 'react'
import { TabBar } from './TabBar'
import { useResizableWidth } from '../hooks/useResizableWidth'
import { usePanelAnimation } from '../hooks/usePanelAnimation'

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

  const { mounted, animating, originalWidthRef, styles: animStyles, onTransitionEnd } = usePanelAnimation(collapsed)

  const panelRef = useRef<HTMLDivElement>(null)

  // 拖拽期间直接设置 DOM style.width，绕过 React 渲染
  const refCallback = useCallback((node: HTMLDivElement | null) => {
    (panelRef as React.MutableRefObject<HTMLDivElement | null>).current = node
    if (node) {
      registerApply((w: number) => { node.style.width = `${w}px` })
    }
  }, [registerApply])

  // 动画开始时锁定原始宽度，防止内容换行
  if (animating && originalWidthRef.current === 0) {
    originalWidthRef.current = width
  }
  if (!animating) {
    originalWidthRef.current = 0
  }

  if (!mounted) return null

  return (
    <div
      ref={refCallback}
      onTransitionEnd={onTransitionEnd}
      style={{
        width, flexShrink: 0, position: 'relative', background: 'var(--bg)',
        borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column',
        ...animStyles,
        // 拖动时去掉 width transition，避免动画平滑导致不跟手；仅展开/折叠保留动画
        transition: dragging ? 'none' : animStyles.transition,
      }}
    >
      {/* 拖拽手柄：左边缘竖条（动画期间禁用） */}
      {!collapsed && (
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
      )}
      {/* 内层 wrapper：动画期间固定原始宽度，外层 overflow:hidden 裁剪 */}
      <div style={{
        display: 'flex', flexDirection: 'column', flex: 1,
        width: animating ? originalWidthRef.current : undefined,
        overflow: 'hidden',
      }}>
        <TabBar />
      </div>
    </div>
  )
}
