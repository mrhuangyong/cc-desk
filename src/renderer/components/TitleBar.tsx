import type { CSSProperties } from 'react'
import { Settings, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { ThemeSwitcher } from './ThemeSwitcher'
import { useStore } from '../state/store'

// WebkitAppRegion is an Electron/WebKit CSS property not present in React's
// CSSProperties. Define a local superset so the drag regions type-check.
type DragStyle = CSSProperties & { WebkitAppRegion?: 'drag' | 'no-drag' }

const drag: DragStyle = { WebkitAppRegion: 'drag' }
const noDrag: DragStyle = { WebkitAppRegion: 'no-drag' }

interface Props {
  projectName: string
  leftCollapsed: boolean
  rightCollapsed: boolean
  onToggleLeft: () => void
  onToggleRight: () => void
}

export function TitleBar({ projectName, leftCollapsed, rightCollapsed, onToggleLeft, onToggleRight }: Props) {
  const { dispatch } = useStore()
  return (
    <div style={{
      display: 'flex', alignItems: 'center', height: 36, padding: '0 8px',
      background: 'var(--bg)', borderBottom: '1px solid var(--border)',
      ...drag
    }}>
      {/* 左侧：macOS 原生红绿灯由系统渲染在左上角，给它预留宽度避免与折叠钮重叠；
          非 macOS 这里为空，窗口控制由系统或后续补。 */}
      <div style={{ width: 70, flexShrink: 0, ...noDrag }} />
      {/* 左栏折叠按钮 */}
      <button
        onClick={onToggleLeft}
        title={leftCollapsed ? '展开左栏' : '收起左栏'}
        aria-label={leftCollapsed ? '展开左栏' : '收起左栏'}
        style={{ padding: '4px 8px', color: 'var(--text-muted)', lineHeight: 1, display: 'inline-flex', alignItems: 'center', ...noDrag }}
      >
        {leftCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
      </button>

      <span style={{ flex: 1, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        {projectName}
      </span>

      {/* 右栏折叠按钮 */}
      <button
        onClick={onToggleRight}
        title={rightCollapsed ? '展开右栏' : '收起右栏'}
        aria-label={rightCollapsed ? '展开右栏' : '收起右栏'}
        style={{ padding: '4px 8px', color: 'var(--text-muted)', lineHeight: 1, display: 'inline-flex', alignItems: 'center', ...noDrag }}
      >
        {rightCollapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
      </button>
      <div style={{ display: 'flex', gap: 8, marginLeft: 8, ...noDrag }}>
        <ThemeSwitcher />
        <button title="设置" onClick={() => dispatch({ type: 'SET_SETTINGS_SECTION', section: 'general' })} style={{ padding: '4px 8px', lineHeight: 1, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center' }}><Settings size={17} /></button>
      </div>
    </div>
  )
}
