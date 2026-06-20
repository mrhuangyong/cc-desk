import { useState } from 'react'
import { Palette, Check } from 'lucide-react'
import { useTheme } from '../hooks/useTheme'
import { Tooltip } from './Tooltip'
import type { ThemeId } from '../types'

const THEMES: { id: ThemeId; label: string; swatch: string }[] = [
  { id: 'codex-light', label: '浅色', swatch: '#ffffff' },
  { id: 'codex-warm', label: '暖白', swatch: '#fdfcfa' },
  { id: 'codex-cool', label: '冷灰', swatch: '#fbfcfd' },
  { id: 'codex-paper', label: '纸感', swatch: '#f8f6f1' },
  { id: 'codex-dark', label: '深色', swatch: '#1a1b1e' },
]

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme()
  const [open, setOpen] = useState(false)

  return (
    <div style={{ position: 'relative' }}>
      <Tooltip label="切换主题">
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="切换主题"
        style={{
          width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 6, color: open ? 'var(--text)' : 'var(--text-muted)', lineHeight: 1,
          background: open ? 'var(--bg-hover)' : 'transparent', transition: 'background .12s, color .12s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text)' }}
        onMouseLeave={(e) => { if (!open) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' } }}
      ><Palette size={15} /></button>
      </Tooltip>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 90 }} />
          <div style={{
            position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 100,
            background: 'var(--bg-elevated)', border: '1px solid var(--border-hair)',
            borderRadius: 8, boxShadow: 'var(--shadow-float)', padding: 4, minWidth: 160,
          }}>
            {THEMES.map(t => (
              <button
                key={t.id}
                onClick={() => { setTheme(t.id); setOpen(false) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '6px 8px', borderRadius: 6,
                  background: theme === t.id ? 'var(--bg-hover)' : 'transparent',
                  border: 'none', color: 'var(--text)', fontSize: 12, cursor: 'pointer',
                  textAlign: 'left', transition: 'background .1s',
                }}
                onMouseEnter={(e) => { if (theme !== t.id) e.currentTarget.style.background = 'var(--bg-hover)' }}
                onMouseLeave={(e) => { if (theme !== t.id) e.currentTarget.style.background = 'transparent' }}
              >
                <span style={{ width: 12, height: 12, borderRadius: 3, background: t.swatch, display: 'inline-block', border: '1px solid var(--border)', flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{t.label}</span>
                {theme === t.id && <Check size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
