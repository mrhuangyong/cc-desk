// src/renderer/components/GoalCard.tsx
// /goal 独立状态卡片:条件/状态/最近评估/清除按钮 + 软阈值提示(>30 轮)。
import { useSelector, useDispatch } from '../state/store'
import type { AppState } from '../state/reducer'

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60}m`
}

const SOFT_TURN_THRESHOLD = 30

export function GoalCard({ onClose }: { onClose: () => void }) {
  const sid = useSelector((s: AppState) => s.activeSessionId)
  const goal = useSelector((s: AppState) => s.goalBySession[sid])
  const dispatch = useDispatch()
  if (!goal) return null
  const elapsed = Date.now() - goal.startedAt
  const isAchieved = goal.status === 'achieved'
  const overThreshold = goal.turns > SOFT_TURN_THRESHOLD && goal.status === 'active'

  const handleClear = () => {
    dispatch({ type: 'CLEAR_GOAL', sessionId: sid })
    window.api?.claude?.clearGoal?.(sid)
    window.api?.claude?.stop(sid)
    onClose()
  }

  return (
    <div style={{
      background: 'var(--surface-1)', borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-float)', padding: 16, maxWidth: 560, margin: '0 auto',
      border: `1px solid ${isAchieved ? 'var(--success, #22c55e)' : 'var(--accent)'}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 16 }}>{isAchieved ? '✅' : '🎯'}</span>
        <strong>Goal</strong>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }} onClick={onClose}>✕</span>
      </div>

      <div style={{ fontSize: 13, marginBottom: 6 }}><strong>条件:</strong> {goal.condition}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
        {isAchieved ? '✓ 已达成' : '● 进行中'}（{goal.turns} 轮 · {fmtDuration(elapsed)}）
      </div>

      {goal.lastReason && (
        <div style={{ fontSize: 12, background: 'var(--bg-hover)', padding: 8, borderRadius: 6, marginBottom: 10, color: 'var(--text-muted)' }}>
          <div style={{ marginBottom: 4, fontWeight: 500 }}>最近评估:</div>
          {goal.lastReason}
        </div>
      )}

      {overThreshold && (
        <div style={{ fontSize: 12, color: '#f59e0b', marginBottom: 10, padding: 8, background: 'rgba(245,158,11,0.1)', borderRadius: 6 }}>
          ⚠️ 已跑 {goal.turns} 轮,确认要继续?(A3+B2:无硬上限,仅提示)
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        {!isAchieved && (
          <button onClick={handleClear} style={{ padding: '4px 12px', fontSize: 12, cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', color: 'var(--text-muted)' }}>清除 goal</button>
        )}
        <button onClick={onClose} style={{ padding: '4px 12px', fontSize: 12, cursor: 'pointer', border: 'none', borderRadius: 6, background: 'var(--bg-hover)', color: 'var(--text)' }}>关闭</button>
      </div>
    </div>
  )
}
