// src/renderer/components/PlanCard.tsx
// 计划模式：模型在 plan 模式下通过 ExitPlanMode 提交的计划。
// 走与 AskUserQuestion 相同的阻塞式 dialog 通道（dialogKind='plan_proposed'）：
// 主进程 handleExitPlanMode 在用户回复前阻塞 SDK 事件循环。
//
// 渲染为 Markdown 计划卡片，底部直接给出授权模式按钮（一步到位）：
//   选择授权模式 → dialogResponse 回复 → 主进程 setPermissionMode + pushMessage
//   拒绝 → dialogResponse 回复 cancelled → 主进程让模型修改计划
import { MarkdownRenderer } from './markdown/MarkdownRenderer'

interface Props {
  sessionId: string
  // 来自 pendingDialog（dialogKind='plan_proposed'）；为 null 时不渲染
  pendingPlan: { reqId: string; plan: string; allowedPrompts?: any[] } | null
  dispatch: (action: any) => void
}

// 计划批准后的可选授权模式（直接显示在卡片底部，一步到位）
const APPROVE_MODES = [
  { label: '自动编辑', desc: '自动接受文件编辑，其他操作仍需确认', icon: '✎' },
  { label: '完全访问', desc: '跳过所有权限检查，完全自动执行', icon: '⚡' },
] as const

export function PlanCard({ sessionId, pendingPlan, dispatch }: Props) {
  if (!pendingPlan || !pendingPlan.plan) return null

  // 用户选定授权模式：回复 dialog，主进程据此 setPermissionMode + 让模型执行
  const approve = (permissionMode: string) => {
    window.api?.claude?.dialogResponse({
      reqId: pendingPlan.reqId,
      result: { behavior: 'completed', result: { permissionMode } },
    })
    // 同步更新会话权限状态：主进程已通过 setPermissionMode 实时切换 SDK 权限，
    // 渲染端需同步写入 activeSession.permissionMode，否则输入框权限标签不刷新，
    // 后续 send 也会带上旧权限。
    dispatch({ type: 'SET_SESSION_PERMISSION', sessionId, permissionMode })
    dispatch({ type: 'ANSWER_DIALOG' })
  }

  // 拒绝计划：保持 plan 模式，让模型修改
  const reject = () => {
    window.api?.claude?.dialogResponse({
      reqId: pendingPlan.reqId,
      result: { behavior: 'cancelled' },
    })
    dispatch({ type: 'ANSWER_DIALOG' })
  }

  return (
    <div style={{
      width: '100%',
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-float)',
      overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
        <strong style={{ fontSize: 13 }}>📋 计划方案（计划模式）</strong>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>ExitPlanMode</span>
      </div>
      <div style={{ maxHeight: 320, overflowY: 'auto', padding: '10px 14px', fontSize: 13 }}>
        <MarkdownRenderer text={pendingPlan.plan} />
      </div>
      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>批准并执行：</span>
          {APPROVE_MODES.map(m => (
            <button key={m.label} onClick={() => approve(m.label)} title={m.desc}
              style={{
                fontSize: 12, padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
                border: '1px solid var(--accent, #2563eb)', background: 'var(--accent, #2563eb)', color: '#fff',
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}>
              <span>{m.icon}</span> {m.label}
            </button>
          ))}
          <button onClick={reject}
            style={{ fontSize: 12, padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer', background: 'transparent', color: 'var(--text)', marginLeft: 'auto' }}>
            再改改
          </button>
        </div>
      </div>
    </div>
  )
}
