import { useEffect } from 'react'

// 顶部"技能"触发的技能列表面板：mock 本地已安装技能，纯展示。
interface Props {
  onClose: () => void
}

const MOCK_SKILLS = [
  { id: 'review', name: '代码审查', desc: '审查当前改动，找出 bug 与可优化点' },
  { id: 'test', name: '生成测试', desc: '为选中代码生成单元测试' },
  { id: 'refactor', name: '重构建议', desc: '给出重构方案与影响分析' },
  { id: 'explain', name: '解释代码', desc: '逐行解释选中代码的作用' }
]

export function SkillsPanel({ onClose }: Props) {
  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '12vh'
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(520px, 90vw)', maxHeight: '70vh', overflowY: 'auto',
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)', padding: 12
        }}
      >
        <div style={{ padding: '4px 8px 10px', fontSize: 11, color: 'var(--text-muted)' }}>本地技能</div>
        {MOCK_SKILLS.map(s => (
          <div
            key={s.id}
            onClick={onClose}
            style={{
              padding: '10px 12px', borderRadius: 'var(--radius)', cursor: 'pointer',
              borderBottom: '1px solid var(--border)'
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <div style={{ color: 'var(--text)', fontSize: 13 }}>⚡ {s.name}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>{s.desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
