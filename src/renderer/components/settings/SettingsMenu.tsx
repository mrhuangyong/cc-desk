import { useStore } from '../../state/store'
import { useI18n } from '../../i18n/useI18n'
import type { SettingsSection } from '../../types'

interface MenuItem { id: SettingsSection | 'back'; labelKey: string }

const ITEMS: MenuItem[] = [
  { id: 'back', labelKey: 'settings.back' },
  { id: 'general', labelKey: 'settings.general' },
  { id: 'code-preview', labelKey: 'settings.codePreview' },
  { id: 'model', labelKey: 'settings.model' },
  { id: 'memory', labelKey: 'settings.memory' },
  { id: 'skills', labelKey: 'settings.skills' },
  { id: 'mcp', labelKey: 'settings.mcp' },
  { id: 'plugins', labelKey: 'settings.plugins' },
  { id: 'commands', labelKey: 'settings.commands' },
  { id: 'hooks', labelKey: 'settings.hooks' },
  { id: 'archived', labelKey: 'settings.archived' },
  { id: 'about', labelKey: 'settings.about' },
]

export function SettingsMenu() {
  const { state, dispatch } = useStore()
  const { t } = useI18n()
  const active = state.activeSettingsSection

  const onClick = (id: MenuItem['id']) => {
    if (id === 'back') dispatch({ type: 'SET_VIEW', view: 'workspace' })
    else dispatch({ type: 'SET_SETTINGS_SECTION', section: id })
  }

  return (
    <div style={{
      width: 200, flexShrink: 0, background: 'var(--bg-sidebar)',
      borderRight: '1px solid var(--border)', padding: '44px 8px 8px', overflowY: 'auto'
    }}>
      {ITEMS.map(item => {
        const isActive = item.id !== 'back' && item.id === active
        return (
          <button
            key={item.id}
            onClick={() => onClick(item.id)}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '8px 12px', marginBottom: 2, borderRadius: 'var(--radius)',
              cursor: 'pointer', border: 'none',
              background: isActive ? 'var(--bg)' : 'transparent',
              color: isActive ? 'var(--text)' : 'var(--text)',
              boxShadow: isActive ? 'var(--shadow-float)' : 'none',
              fontFamily: 'var(--font)', fontSize: 13
            }}
          >{t(item.labelKey)}</button>
        )
      })}
    </div>
  )
}
