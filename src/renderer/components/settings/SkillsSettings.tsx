import { useState } from 'react'
import { mockSkills } from '../../state/mockData'
import { SettingsLayout } from './SettingsLayout'

const inputStyle: React.CSSProperties = { padding: '6px 10px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)' }
const rowStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }

export function SkillsSettings() {
  const [q, setQ] = useState('')
  const [skills, setSkills] = useState(() => mockSkills.map(s => ({ ...s })))
  const filtered = skills.filter(s => s.name.toLowerCase().includes(q.toLowerCase()) || s.desc.toLowerCase().includes(q.toLowerCase()))
  const toggle = (id: string) => setSkills(prev => prev.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s))

  return (
    <SettingsLayout title="技能">
      <input placeholder="搜索技能…" value={q} onChange={e => setQ(e.target.value)} style={inputStyle} />
      {filtered.map(s => (
        <div key={s.id} style={rowStyle}>
          <div>
            <div style={{ color: 'var(--text)' }}>{s.name}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{s.desc}</div>
          </div>
          <button
            onClick={() => toggle(s.id)}
            aria-label={`${s.enabled ? '禁用' : '启用'} ${s.name}`}
            style={{
              padding: '4px 10px', borderRadius: 999, cursor: 'pointer', border: '1px solid var(--border)',
              background: s.enabled ? 'var(--accent)' : 'transparent',
              color: s.enabled ? 'var(--accent-text)' : 'var(--text-muted)', fontSize: 12
            }}
          >{s.enabled ? '已启用' : '已禁用'}</button>
        </div>
      ))}
    </SettingsLayout>
  )
}
