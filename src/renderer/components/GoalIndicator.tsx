// src/renderer/components/GoalIndicator.tsx
// goal 激活时常驻对话区顶部的指示条:条件简述 + 轮数 + token + 时长。点击展开 GoalCard。
import { useSelector } from '../state/store'
import type { AppState } from '../state/reducer'

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h${m % 60}m`
}

export function GoalIndicator({ onOpen }: { onOpen: () => void }) {
  const sid = useSelector((s: AppState) => s.activeSessionId)
  const goal = useSelector((s: AppState) => s.goalBySession[sid])
  if (!goal || goal.status !== 'active') return null
  const elapsed = Date.now() - goal.startedAt
  const condShort = goal.condition.length > 40 ? goal.condition.slice(0, 40) + '…' : goal.condition
  return (
    <div
      onClick={onOpen}
      title={goal.condition}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 14px', margin: '0 28px 8px',
        background: 'var(--surface-1)', borderRadius: 'var(--radius)',
        border: '1px solid var(--accent)', cursor: 'pointer', fontSize: 12,
        color: 'var(--text)',
      }}
    >
      <span style={{ color: 'var(--accent)' }}>◎ /goal active</span>
      <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>·</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{condShort}</span>
      <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>· 已运行 {goal.turns} 轮 · {fmtDuration(elapsed)}</span>
    </div>
  )
}
