import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useStore } from '../../state/store'
import { SettingsCard } from './SettingsCard'
import { SettingsRow } from './SettingsRow'
import { AppIcon, APP_COLORS } from '../editorIcons'
import { useI18n } from '../../i18n/useI18n'
import type { OpenApp } from '../../types'

const addBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '5px 12px', fontSize: 12, cursor: 'pointer',
  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  background: 'var(--accent)', color: 'var(--accent-text)',
}

const delBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 24, height: 24, cursor: 'pointer', border: 'none',
  background: 'transparent', color: 'var(--text-muted)', borderRadius: 'var(--radius)',
}

export function OpenAppsSettings() {
  const { state, dispatch } = useStore()
  const { t } = useI18n()
  const apps: OpenApp[] = state.settings.openApps ?? []
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)

  const persist = (next: OpenApp[]) => {
    dispatch({ type: 'SET_SETTINGS', settings: { openApps: next } })
    window.api?.settings.save({ openApps: next })
  }

  // 从选中的文件路径推导 OpenApp：
  // - 路径以 .app 结尾（macOS 应用包）→ name 取 .app 基名（去扩展名），command = open -a "<name>" .
  // - 其它/普通可执行文件 → name=basename，command="<path> ."
  const appFromFile = (filePath: string): OpenApp | null => {
    const base = filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath
    if (base.toLowerCase().endsWith('.app')) {
      const name = base.replace(/\.app$/i, '')
      return { id: crypto.randomUUID(), name, command: `open -a "${name}" .` }
    }
    return { id: crypto.randomUUID(), name: base, command: `${filePath} .` }
  }

  const handleAdd = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const filePath = await window.api?.dialog?.openAppFile?.()
      if (!filePath) { setBusy(false); return }  // 用户取消
      const app = appFromFile(filePath)
      if (!app) { setBusy(false); return }
      // 去重：同名已存在则提示
      if (apps.some(a => a.name === app.name)) {
        setNotice({ kind: 'error', text: t('openApps.exists') })
        setBusy(false)
        return
      }
      persist([...apps, app])
    } catch (err) {
      setNotice({ kind: 'error', text: String(err) })
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = (app: OpenApp) => {
    persist(apps.filter(a => a.id !== app.id))
  }

  return (
    <SettingsCard>
      {apps.length === 0 && (
        <SettingsRow title={t('openApps.empty')} noBorder>
          <button onClick={handleAdd} disabled={busy} style={addBtnStyle}>
            <Plus size={13} /> {t('openApps.add')}
          </button>
        </SettingsRow>
      )}
      {apps.map((app, i) => (
        <SettingsRow
          key={app.id}
          title={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: APP_COLORS[app.id] ?? 'var(--text)', display: 'inline-flex' }}>
                <AppIcon id={app.id} size={15} />
              </span>
              <span style={{ color: 'var(--text)', fontSize: 13 }}>{app.name}</span>
              {app.builtin && (
                <span style={{ fontSize: 10, color: 'var(--text-faint)', border: '1px solid var(--border)', borderRadius: 4, padding: '0 4px' }}>
                  {t('openApps.builtin')}
                </span>
              )}
            </span>
          }
          desc={<span style={{ fontFamily: 'var(--font-mono)' }}>{t('openApps.command')}：{app.command}</span>}
          noBorder={i === apps.length - 1}
        >
          {!app.builtin && (
            <button
              onClick={() => handleDelete(app)}
              aria-label="删除"
              style={delBtnStyle}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--danger, #dc2626)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' }}
            >
              <Trash2 size={14} />
            </button>
          )}
        </SettingsRow>
      ))}
      {apps.length > 0 && (
        <SettingsRow title={notice?.kind === 'error' ? notice.text : t('openApps.chooseApp')} noBorder>
          <button onClick={handleAdd} disabled={busy} style={addBtnStyle}>
            <Plus size={13} /> {t('openApps.add')}
          </button>
        </SettingsRow>
      )}
    </SettingsCard>
  )
}
