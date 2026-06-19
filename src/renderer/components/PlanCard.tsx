// src/renderer/components/PlanCard.tsx
// 计划模式：模型在 plan 模式下通过 ExitPlanMode 提交的计划。
// 渲染为 Markdown 计划卡片 + 批准/拒绝。
//   批准：会话权限切回「变更前确认」并 dismiss 卡片。
//         注意 permissionMode 在下一条消息发送时才传给 SDK（持久 query 复用），
//         故新权限对用户下一条消息生效——在提示文案中说明。
//   拒绝：仅 dismiss，保持 plan 模式，用户可继续要求修改计划。
import { MarkdownRenderer } from './markdown/MarkdownRenderer'
import type { PlanProposal } from '../types'

interface Props {
  sessionId: string
  plan: PlanProposal | null
  dispatch: (action: any) => void
}

export function PlanCard({ sessionId, plan, dispatch }: Props) {
  if (!plan || !plan.plan) return null
  const dismiss = () => dispatch({ type: 'DISMISS_PLAN', sessionId })
  const approve = () => {
    dispatch({ type: 'SET_SESSION_PERMISSION', sessionId, permissionMode: '变更前确认' })
    dismiss()
  }
  return (
    <div style={{
      position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
      zIndex: 40, width: 'min(640px, calc(100% - 32px))',
      background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10,
      boxShadow: '0 4px 20px rgba(0,0,0,0.18)', overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
        <strong style={{ fontSize: 13 }}>📋 计划方案（计划模式）</strong>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>ExitPlanMode</span>
      </div>
      <div style={{ maxHeight: 320, overflowY: 'auto', padding: '8px 12px', fontSize: 13 }}>
        <MarkdownRenderer text={plan.plan} />
      </div>
      <div style={{ display: 'flex', gap: 8, padding: '8px 12px', borderTop: '1px solid var(--border)', alignItems: 'center' }}>
        <button onClick={approve}
          style={{ fontSize: 12, padding: '5px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', background: 'var(--accent, #2563eb)', color: '#fff' }}>
          批准计划
        </button>
        <button onClick={dismiss}
          style={{ fontSize: 12, padding: '5px 14px', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer', background: 'transparent', color: 'var(--text)' }}>
          再改改
        </button>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
          批准后权限切回「变更前确认」，下一条消息生效
        </span>
      </div>
    </div>
  )
}
