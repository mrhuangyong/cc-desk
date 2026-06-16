import { useStore } from '../../state/store'
import type { SettingsSection } from '../../types'

interface MenuItem { id: SettingsSection | 'back'; label: string }

const ITEMS: MenuItem[] = [
  { id: 'back', label: '← 返回工作区' },
  { id: 'general', label: '常规' },
  { id: 'code-preview', label: '代码预览' },
  { id: 'model', label: '模型设置' },
  { id: 'skills', label: '技能' },
  { id: 'mcp', label: 'MCP 服务器' },
  { id: 'plugins', label: '插件' },
  { id: 'commands', label: '命令' },
  { id: 'hooks', label: 'hooks' }
]

export function SettingsMenu() {
  const { state, dispatch } = useStore()
  const active = state.activeSettingsSection

  const onClick = (id: MenuItem['id']) => {
    if (id === 'back') dispatch({ type: 'SET_VIEW', view: 'workspace' })
    else dispatch({ type: 'SET_SETTINGS_SECTION', section: id })
  }

  return (
    <div style={{
      width: 200, flexShrink: 0, background: 'var(--bg-sidebar)',
      borderRight: '1px solid var(--border)', padding: 8, overflowY: 'auto'
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
              background: isActive ? 'var(--bg-hover)' : 'transparent',
              color: isActive ? 'var(--accent)' : 'var(--text)',
              fontFamily: 'var(--font)', fontSize: 13
            }}
          >{item.label}</button>
        )
      })}
    </div>
  )
}
