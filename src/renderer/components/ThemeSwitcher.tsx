import { useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import type { ThemeId } from '../types'

const THEMES: { id: ThemeId; label: string; swatch: string }[] = [
  { id: 'dark-warm', label: '暖色暗夜', swatch: '#d97757' },
  { id: 'dark-cool', label: '冷峻深空', swatch: '#2f81f7' },
  { id: 'light-editorial', label: '纸感明亮', swatch: '#8b6f47' },
  { id: 'dark-acid', label: '酸性极客', swatch: '#ccff00' }
]

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme()
  const [open, setOpen] = useState(false)

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="切换主题"
        style={{ fontSize: 14, padding: '4px 8px' }}
      >🎨</button>
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
              <span style={{ width: 12, height: 12, borderRadius: 2, background: t.swatch, display: 'inline-block' }} />
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
