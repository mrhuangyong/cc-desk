import { useState, useMemo } from 'react'
import { ChevronDown } from 'lucide-react'
import { Tooltip } from './Tooltip'
import { AppIcon, APP_COLORS } from './editorIcons'
import { useStore } from '../state/store'
import { useI18n } from '../i18n/useI18n'
import type { OpenApp } from '../types'

// 共享 ghost 按钮样式（与 TitleBar.GhostButton 一致）
function ghostBtnStyle(extra?: React.CSSProperties): React.CSSProperties {
  return {
    height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: 6, color: 'var(--text-muted)', lineHeight: 1,
    background: 'transparent', transition: 'background .12s, color .12s',
    border: 'none', padding: 0, cursor: 'pointer', ...extra,
  }
}

export function OpenInEditorButton() {
  const { state, dispatch } = useStore()
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  const openApps: OpenApp[] = state.settings.openApps ?? []

  const { project, projectPath } = useMemo(() => {
    const p = state.projects.find(p => p.sessions.some(s => s.id === state.activeSessionId))
    return { project: p, projectPath: p?.path }
  }, [state.projects, state.activeSessionId])

  const defaultApp: OpenApp | undefined = useMemo(() => {
    if (openApps.length === 0) return undefined
    return openApps.find(a => a.id === project?.defaultOpenAppId) ?? openApps[0]
  }, [openApps, project?.defaultOpenAppId])

  const disabled = !projectPath || !defaultApp
  const tooltip = !projectPath
    ? t('openInEditor.noProject')
    : t('openInEditor.openWith').replace('{name}', defaultApp?.name ?? '')

  // 直接用默认应用打开（点主图标区）
  const handleOpenDefault = () => {
    if (disabled || !projectPath || !defaultApp) return
    void window.api?.app?.openInEditor?.(defaultApp.command, projectPath)
  }

  // 从下拉菜单选应用：打开 + 持久化为项目默认
  const handleSelect = (app: OpenApp) => {
    if (!projectPath || !project) { setOpen(false); return }
    void window.api?.app?.openInEditor?.(app.command, projectPath)
    if (project.defaultOpenAppId !== app.id) {
      dispatch({ type: 'SET_PROJECT_DEFAULT_OPEN_APP', projectId: project.id, appId: app.id })
    }
    setOpen(false)
  }

  // 主图标按钮 hover（分组整体 hover 变亮）
  const onEnter = (e: React.MouseEvent<HTMLElement>) => {
    if (!disabled) { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text)' }
  }
  const onLeave = (e: React.MouseEvent<HTMLElement>) => {
    if (!disabled && !open) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' }
  }

  return (
    <div
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 6, opacity: disabled ? 0.4 : 1 }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <Tooltip label={tooltip}>
        <button
          onClick={handleOpenDefault}
          aria-label={tooltip}
          style={ghostBtnStyle({ paddingLeft: 6 })}
          onMouseEnter={onEnter}
          onMouseLeave={onLeave}
        >
          {defaultApp && (
            <span style={{ color: APP_COLORS[defaultApp.id] ?? 'var(--text)', display: 'inline-flex', alignItems: 'center' }}>
              <AppIcon id={defaultApp.id} size={15} />
            </span>
          )}
        </button>
      </Tooltip>
      <Tooltip label={t('openInEditor.choose')}>
        <button
          onClick={() => !disabled && setOpen(o => !o)}
          aria-label={t('openInEditor.choose')}
          style={ghostBtnStyle({ width: 16, paddingRight: 4, paddingLeft: 0, background: open ? 'var(--bg-hover)' : undefined, color: open ? 'var(--text)' : undefined })}
          onMouseEnter={onEnter}
          onMouseLeave={onLeave}
        >
          <ChevronDown size={13} />
        </button>
      </Tooltip>
      {open && !disabled && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 90 }} />
          <div style={{
            position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 100,
            background: 'var(--bg-elevated)', border: '1px solid var(--border-hair)',
            borderRadius: 8, boxShadow: 'var(--shadow-float)', padding: 4, minWidth: 170,
          }}>
            {openApps.map(app => {
              const active = app.id === defaultApp?.id
              return (
                <button
                  key={app.id}
                  onClick={() => handleSelect(app)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    padding: '6px 8px', borderRadius: 6,
                    background: active ? 'var(--bg-hover)' : 'transparent',
                    border: 'none', color: 'var(--text)', fontSize: 12, cursor: 'pointer',
                    textAlign: 'left', transition: 'background .1s',
                  }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)' }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent' }}
                >
                  <span style={{ color: APP_COLORS[app.id] ?? 'var(--text)', display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
                    <AppIcon id={app.id} size={14} />
                  </span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{app.name}</span>
                  {active && <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{t('openInEditor.default')}</span>}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
