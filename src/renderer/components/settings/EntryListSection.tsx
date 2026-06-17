import { useState } from 'react'
import { SettingsLayout } from './SettingsLayout'

interface Entry {
  id: string
  name: string
  desc: string
  enabled: boolean
}

interface Props {
  title: string
  entries: Entry[]
  loading?: boolean
  desc?: string
  // 提供 onToggle 则 checkbox 可切换；否则只读展示
  onToggle?: (name: string) => void
}

const inputStyle: React.CSSProperties = { width: '100%', padding: '6px 10px', background: 'var(--bg-sidebar)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)' }
const entryRowStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }

export function EntryListSection({ title, entries, loading, desc, onToggle }: Props) {
  const [q, setQ] = useState('')
  const filtered = entries.filter(e => e.name.toLowerCase().includes(q.toLowerCase()))
  return (
    <SettingsLayout title={title}>
      {desc && <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 10 }}>{desc}</div>}
      <input placeholder={`搜索${title}…`} value={q} onChange={e => setQ(e.target.value)} style={{ ...inputStyle, marginBottom: 8 }} />
      {loading && <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 13 }}>加载中…</div>}
      {!loading && filtered.length === 0 && <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 13 }}>无匹配项</div>}
      {filtered.map(e => (
        <div key={e.id} style={entryRowStyle}>
          <div>
            <div style={{ color: 'var(--text)' }}>{e.name}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{e.desc}</div>
          </div>
          <input
            type="checkbox"
            checked={e.enabled}
            onChange={() => onToggle?.(e.name)}
            disabled={!onToggle}
            aria-label={`启用 ${e.name}`}
            style={{ accentColor: 'var(--accent)', cursor: onToggle ? 'pointer' : 'default' }}
          />
        </div>
      ))}
    </SettingsLayout>
  )
}
