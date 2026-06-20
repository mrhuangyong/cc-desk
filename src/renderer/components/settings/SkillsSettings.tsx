import { useEffect, useState } from 'react'
import type { ClaudeSkill } from '../../../main/claude-config'
import { Toggle } from './Toggle'
import { SkillModal } from './SkillModal'
import { Hexagon } from 'lucide-react'

export function SkillsSettings() {
  const [skills, setSkills] = useState<ClaudeSkill[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<ClaudeSkill | null>(null)

  // 技能来自已启用插件 + 用户级 ~/.claude/skills/，只读展示
  const reload = () => {
    setLoading(true)
    window.api?.cc?.skills.get().then(list => { setSkills(list); setLoading(false) })
  }
  useEffect(() => { reload() }, [])

  const filtered = skills.filter(s =>
    s.name.toLowerCase().includes(q.toLowerCase()) || s.desc.toLowerCase().includes(q.toLowerCase())
  )

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px', background: 'var(--bg-sidebar)',
    border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)',
    outline: 'none'
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      {/* 标题 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <h2 style={{ color: 'var(--text)', fontSize: 18, margin: 0 }}>技能</h2>
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 14 }}>
        来自已启用插件的 skills/ 目录 + 用户级 ~/.claude/skills/。启用/停用请在「插件」页切换对应插件。
      </div>

      {/* 搜索框 */}
      <input placeholder="搜索技能..." value={q} onChange={e => setQ(e.target.value)} style={{ ...inputStyle, marginBottom: 14 }} />

      {/* 计数标题 */}
      <div style={{ color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
        可用技能 {skills.length}
      </div>

      {/* 技能列表卡片 */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', background: 'var(--bg)', boxShadow: 'var(--shadow-float)' }}>
        {loading && (
          <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center', fontSize: 13 }}>加载中…</div>
        )}
        {!loading && filtered.length === 0 && (
          <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center', fontSize: 13 }}>无匹配技能</div>
        )}
        {filtered.map((s, i) => (
          <div key={s.id} onClick={() => setSelected(s)} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
            borderBottom: i < filtered.length - 1 ? '1px solid var(--border)' : 'none',
            cursor: 'pointer'
          }}>
            <span style={{ color: 'var(--accent)', fontSize: 16, flexShrink: 0, display: 'inline-flex' }}><Hexagon size={16} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-mono)' }}>{s.name}</span>
                <span style={{
                  padding: '1px 7px', borderRadius: 999, fontSize: 10,
                  border: '1px solid var(--border)', color: 'var(--text-muted)'
                }}>{s.scope}</span>
                <span style={{
                  padding: '1px 7px', borderRadius: 999, fontSize: 10,
                  border: '1px solid var(--border)', color: 'var(--text-muted)'
                }}>{s.source}</span>
              </div>
              <div style={{
                color: 'var(--text-muted)', fontSize: 12, marginTop: 3,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
              }}>{s.desc}</div>
            </div>
            <span onClick={e => e.stopPropagation()}>
              <Toggle on={s.enabled} onChange={reload} aria-label={`${s.name} 状态`} />
            </span>
          </div>
        ))}
      </div>
      {selected && <SkillModal skill={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
