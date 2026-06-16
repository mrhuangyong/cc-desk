import { useState } from 'react'
import { mockSkills } from '../../state/mockData'
import { Toggle } from './Toggle'
import { Plus, ChevronDown, RefreshCw, Hexagon } from 'lucide-react'

export function SkillsSettings() {
  const [q, setQ] = useState('')
  const [skills, setSkills] = useState(() => mockSkills.map(s => ({ ...s })))
  const filtered = skills.filter(s =>
    s.name.toLowerCase().includes(q.toLowerCase()) || s.desc.toLowerCase().includes(q.toLowerCase())
  )
  const toggle = (id: string) => setSkills(prev => prev.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s))

  const iconBtn: React.CSSProperties = {
    padding: '4px 8px', fontSize: 14, cursor: 'pointer',
    background: 'transparent', border: 'none', color: 'var(--text-muted)', lineHeight: 1
  }
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px', background: 'var(--bg-sidebar)',
    border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)',
    outline: 'none'
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      {/* 标题 + 操作图标 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <h2 style={{ color: 'var(--text)', fontSize: 18, margin: 0 }}>技能</h2>
        <div style={{ display: 'flex', gap: 4 }}>
          <button title="添加技能" style={iconBtn}><Plus size={14} /></button>
          <button title="排序/展开" style={iconBtn}><ChevronDown size={14} /></button>
          <button title="刷新" style={iconBtn}><RefreshCw size={14} /></button>
        </div>
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 14 }}>
        管理项目级与用户级技能。启用后可在聊天里通过 $skill-name 使用。
      </div>

      {/* 搜索框 */}
      <input placeholder="搜索技能..." value={q} onChange={e => setQ(e.target.value)} style={{ ...inputStyle, marginBottom: 14 }} />

      {/* 计数标题 */}
      <div style={{ color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
        工作区与个人技能 {skills.length}
      </div>

      {/* 技能列表卡片 */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', background: 'var(--bg)', boxShadow: 'var(--shadow-float)' }}>
        {filtered.length === 0 && (
          <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center', fontSize: 13 }}>无匹配技能</div>
        )}
        {filtered.map((s, i) => (
          <div key={s.id} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
            borderBottom: i < filtered.length - 1 ? '1px solid var(--border)' : 'none'
          }}>
            <span style={{ color: 'var(--accent)', fontSize: 16, flexShrink: 0, display: 'inline-flex' }}><Hexagon size={16} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-mono)' }}>{s.name}</span>
                <span style={{
                  padding: '1px 7px', borderRadius: 999, fontSize: 10,
                  border: '1px solid var(--border)', color: 'var(--text-muted)'
                }}>{s.scope}</span>
              </div>
              <div style={{
                color: 'var(--text-muted)', fontSize: 12, marginTop: 3,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
              }}>{s.desc}</div>
            </div>
            <Toggle on={s.enabled} onChange={() => toggle(s.id)} aria-label={`${s.enabled ? '禁用' : '启用'} ${s.name}`} />
          </div>
        ))}
      </div>
    </div>
  )
}
