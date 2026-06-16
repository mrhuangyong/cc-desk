import { useState } from 'react'
import type { SettingsEntry } from '../../types'
import { SettingsLayout } from './SettingsLayout'

interface Props { title: string; entries: SettingsEntry[] }

const inputStyle: React.CSSProperties = { padding: '6px 10px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)' }
const entryRowStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }

export function EntryListSection({ title, entries }: Props) {
  const [q, setQ] = useState('')
  const filtered = entries.filter(e => e.name.toLowerCase().includes(q.toLowerCase()))
  return (
    <SettingsLayout title={title}>
      <input placeholder={`搜索${title}…`} value={q} onChange={e => setQ(e.target.value)} style={inputStyle} />
      {filtered.map(e => (
        <div key={e.id} style={entryRowStyle}>
          <div>
            <div style={{ color: 'var(--text)' }}>{e.name}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{e.desc}</div>
          </div>
          <input type="checkbox" defaultChecked={e.enabled} aria-label={`启用 ${e.name}`} />
        </div>
      ))}
    </SettingsLayout>
  )
}
