import type { CSSProperties } from 'react'
import { Settings, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { ThemeSwitcher } from './ThemeSwitcher'
import { useStore } from '../state/store'
import { useI18n } from '../i18n/useI18n'

// WebkitAppRegion is an Electron/WebKit CSS property not present in React's
// CSSProperties. Define a local superset so the drag regions type-check.
type DragStyle = CSSProperties & { WebkitAppRegion?: 'drag' | 'no-drag' }

const drag: DragStyle = { WebkitAppRegion: 'drag' }
const noDrag: DragStyle = { WebkitAppRegion: 'no-drag' }

// ghost 图标按钮：Codex 式，默认淡，hover 才浮出底色
function GhostButton({ children, title, onClick, ariaLabel }: {
  children: React.ReactNode; title: string; onClick: () => void; ariaLabel?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={ariaLabel ?? title}
      style={{
        width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 6, color: 'var(--text-muted)', lineHeight: 1,
        transition: 'background .12s, color .12s', ...noDrag,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' }}
    >
      {children}
    </button>
  )
}

interface Props {
  projectName: string
  leftCollapsed: boolean
  rightCollapsed: boolean
  onToggleLeft: () => void
  onToggleRight: () => void
}

export function TitleBar({ projectName, leftCollapsed, rightCollapsed, onToggleLeft, onToggleRight }: Props) {
  const { dispatch } = useStore()
  const { t } = useI18n()
  return (
    <div style={{
      display: 'flex', alignItems: 'center', height: 36, padding: '0 8px',
      background: 'var(--bg)', borderBottom: '1px solid var(--border-hair)',
      ...drag
    }}>
      {/* 左侧：macOS 原生红绿灯预留；非 macOS 留窄边 */}
      <div style={{ width: 70, flexShrink: 0, ...noDrag }} />

      {/* 左栏折叠 */}
      <GhostButton title={leftCollapsed ? '展开左栏' : '收起左栏'} onClick={onToggleLeft} ariaLabel={leftCollapsed ? '展开左栏' : '收起左栏'}>
        {leftCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
      </GhostButton>

      {/* 项目名：mono 小字，居中 */}
      <span style={{
        flex: 1, textAlign: 'center', color: 'var(--text-faint)',
        fontSize: 12, fontFamily: 'var(--font-mono)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0 8px',
        ...drag
      }}>
        {projectName}
      </span>

      {/* 右侧工具组 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, ...noDrag }}>
        <GhostButton title={t('title.settings')} onClick={() => dispatch({ type: 'SET_SETTINGS_SECTION', section: 'general' })}>
          <Settings size={15} />
        </GhostButton>
        <ThemeSwitcher />
        <GhostButton title={rightCollapsed ? '展开右栏' : '收起右栏'} onClick={onToggleRight} ariaLabel={rightCollapsed ? '展开右栏' : '收起右栏'}>
          {rightCollapsed ? <PanelRightOpen size={15} /> : <PanelRightClose size={15} />}
        </GhostButton>
      </div>
    </div>
  )
}
