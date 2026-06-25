import { ShieldCheck, ShieldX } from 'lucide-react'
import { useStore } from '../state/store'

// 权限授权面板：canUseTool 回调对写/执行类工具触发（dialogKind='permission_request'）。
// 显示工具名、决策原因、操作摘要，用户批准（allow）或拒绝（deny）。
// 复用 AskUserQuestion 的 dialog 通道：批准发 {behavior:'completed'}，拒绝发 {behavior:'cancelled'}。
export function PermissionPanel() {
  const { state, dispatch } = useStore()
  const dialog = state.pendingDialog!
  const p = dialog.payload ?? {}
  const displayName: string = p.displayName ?? p.toolName ?? '工具'
  const decisionReason: string | undefined = p.decisionReason
  const description: string | undefined = p.description
  const input: Record<string, unknown> = p.input ?? {}

  // 操作摘要：常见工具的关键字段（文件路径 / 命令），截断显示
  const summary = (() => {
    const cmd = (input.command as string) || (input.prompt as string)
    if (cmd) return cmd.length > 120 ? cmd.slice(0, 120) + '…' : cmd
    const fp = input.file_path as string
    if (fp) return fp
    return undefined
  })()

  const respond = (behavior: 'completed' | 'cancelled', autoAllow = false) => {
    window.api?.claude?.dialogResponse({ reqId: dialog.reqId, result: { behavior, ...(autoAllow ? { autoAllow: true } : {}) } })
    dispatch({ type: 'ANSWER_DIALOG' })
  }

  return (
    <div style={{ background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-float)', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, background: 'var(--bg-hover)', color: 'var(--text-muted)' }}>授权请求</span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{displayName}</span>
      </div>
      {decisionReason && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{decisionReason}</div>
      )}
      {description && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{description}</div>
      )}
      {summary && (
        <div style={{ padding: '6px 8px', borderRadius: 6, background: 'var(--bg)', border: '1px solid var(--border)', fontSize: 12, color: 'var(--text)', fontFamily: 'var(--font-mono, monospace)', wordBreak: 'break-all', maxHeight: 96, overflowY: 'auto' }}>
          {summary}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button
          onClick={() => respond('cancelled')}
          style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', cursor: 'pointer', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          <ShieldX size={13} /> 拒绝
        </button>
        <button
          onClick={() => respond('completed')}
          style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', cursor: 'pointer', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          <ShieldCheck size={13} /> 本次批准
        </button>
        <button
          onClick={() => respond('completed', true)}
          title={`本会话内对「${displayName}」类操作不再询问`}
          style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: 'var(--accent-text)', cursor: 'pointer', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          <ShieldCheck size={13} /> 自动允许此类
        </button>
      </div>
    </div>
  )
}
