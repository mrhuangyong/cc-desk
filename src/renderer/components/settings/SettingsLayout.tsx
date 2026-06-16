import type { ReactNode } from 'react'

export function SettingsLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <h2 style={{ color: 'var(--text)', fontSize: 18, marginBottom: 16 }}>{title}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </div>
  )
}
