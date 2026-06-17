import type { SystemNotice } from '../types'

const LEVEL_COLOR: Record<string, string> = {
  info: 'var(--text-muted)', warn: '#d97706', error: '#ef4444',
}

export function Notices({ notices }: { notices: SystemNotice[] }) {
  if (!notices?.length) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 6 }}>
      {notices.map(n => (
        <div key={n.id} style={{ fontSize: 11, color: LEVEL_COLOR[n.level] ?? 'var(--text-muted)' }}>{n.text}</div>
      ))}
    </div>
  )
}
