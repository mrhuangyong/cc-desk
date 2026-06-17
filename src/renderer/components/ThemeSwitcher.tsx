import { useState } from 'react'
import { Palette } from 'lucide-react'
import { useTheme } from '../hooks/useTheme'
import type { ThemeId } from '../types'

const THEMES: { id: ThemeId; label: string; swatch: string }[] = [
  { id: 'codex-light', label: 'Codex 浅色', swatch: '#ffffff' },
  { id: 'codex-warm', label: 'Codex 暖白', swatch: '#fdfcfa' },
  { id: 'codex-cool', label: 'Codex 冷灰', swatch: '#fbfcfd' },
  { id: 'codex-paper', label: 'Codex 纸感', swatch: '#f8f6f1' },
  { id: 'codex-dark', label: 'Codex 深色', swatch: '#1a1b1e' },
]

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme()
  const [open, setOpen] = useState(false)

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="切换主题"
        style={{ padding: '4px 8px', display: 'inline-flex', alignItems: 'center', color: 'var(--text-muted)' }}
      ><Palette size={14} /></button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '100%',
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', padding: 4, minWidth: 150, zIndex: 100
        }}>
          {THEMES.map(t => (
            <button
              key={t.id}
              onClick={() => { setTheme(t.id); setOpen(false) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '6px 8px', borderRadius: 'var(--radius)',
                background: theme === t.id ? 'var(--bg-hover)' : 'transparent'
              }}
            >
              <span style={{ width: 12, height: 12, borderRadius: 2, background: t.swatch, display: 'inline-block', border: '1px solid var(--border)' }} />
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
