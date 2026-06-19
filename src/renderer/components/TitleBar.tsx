import type { CSSProperties } from 'react'
import { Settings, Plus, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, ListChecks } from 'lucide-react'
import { ThemeSwitcher } from './ThemeSwitcher'
import { Tooltip } from './Tooltip'
import { useStore } from '../state/store'
import { useI18n } from '../i18n/useI18n'

// WebkitAppRegion is an Electron/WebKit CSS property not present in React's
// CSSProperties. Define a local superset so the drag regions type-check.
type DragStyle = CSSProperties & { WebkitAppRegion?: 'drag' | 'no-drag' }

const drag: DragStyle = { WebkitAppRegion: 'drag' }
const noDrag: DragStyle = { WebkitAppRegion: 'no-drag' }

// ghost 图标按钮：Codex 式，默认淡，hover 才浮出底色
// active=true：表示当前处于开启态，图标常亮提示
function GhostButton({ children, title, onClick, ariaLabel, active }: {
  children: React.ReactNode; title: string; onClick: () => void; ariaLabel?: string; active?: boolean
}) {
  const rest = active ? 'var(--text)' : 'var(--text-muted)'
  return (
    <Tooltip label={title}>
      <button
        onClick={onClick}
        title={title}
        aria-label={ariaLabel ?? title}
        style={{
          width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 6, color: rest, lineHeight: 1,
          transition: 'background .12s, color .12s', ...noDrag,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = rest }}
      >
        {children}
      </button>
    </Tooltip>
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
  const { state, dispatch } = useStore()
  const { t } = useI18n()
  const taskPanelOpen = !state.panelFold.root

  // 折叠态：左栏入口不可见，这里在折叠按钮右侧补「新建会话 / 设置」两个高频入口
  const handleNewSession = () => {
    const active = state.projects.find(p => p.sessions.some(s => s.id === state.activeSessionId))
    const pid = (active ?? state.projects[0])?.id
    if (pid) dispatch({ type: 'ADD_SESSION', projectId: pid })
  }
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

      {/* 折叠态补充入口：左栏收起时，新建会话与设置挪到 TitleBar */}
      {leftCollapsed && (
        <>
          <GhostButton title={t('left.newSession')} onClick={handleNewSession} ariaLabel={t('left.newSession')}>
            <Plus size={15} />
          </GhostButton>
          <GhostButton title={t('title.settings')} onClick={() => dispatch({ type: 'SET_SETTINGS_SECTION', section: 'general' })} ariaLabel={t('title.settings')}>
            <Settings size={15} />
          </GhostButton>
        </>
      )}

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
        {/* 悬浮任务面板：与右栏独立，激活(展开)时图标常亮 */}
        <GhostButton
          title={taskPanelOpen ? t('title.taskPanelHide') : t('title.taskPanelShow')}
          ariaLabel={taskPanelOpen ? t('title.taskPanelHide') : t('title.taskPanelShow')}
          active={taskPanelOpen}
          onClick={() => dispatch({ type: 'SET_PANEL_FOLD', panel: 'root', folded: !state.panelFold.root })}>
          <ListChecks size={15} />
        </GhostButton>
        <ThemeSwitcher />
        <GhostButton title={rightCollapsed ? '展开右栏' : '收起右栏'} onClick={onToggleRight} ariaLabel={rightCollapsed ? '展开右栏' : '收起右栏'}>
          {rightCollapsed ? <PanelRightOpen size={15} /> : <PanelRightClose size={15} />}
        </GhostButton>
      </div>
    </div>
  )
}
