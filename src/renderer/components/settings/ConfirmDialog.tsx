// src/renderer/components/settings/ConfirmDialog.tsx
// 危险操作确认对话框：固定遮罩 + 居中卡片 + 取消/危险确认按钮。
// PluginSettings（卸载/移除市场）、CommandSettings（删除）原本各自内联这套结构，
// 现统一抽出。第三处（移除市场）的级联插件列表作为 children 传入。
import type { CSSProperties, ReactNode } from 'react'

interface ConfirmDialogProps {
  /** 标题/正文（主提示语） */
  title: ReactNode
  /** 可选补充内容（如级联影响列表），渲染在标题与按钮之间 */
  children?: ReactNode
  /** 确认按钮文案 */
  confirmLabel: string
  /** 确认回调 */
  onConfirm: () => void
  /** 关闭（取消/点遮罩）回调 */
  onClose: () => void
  /** 卡片宽度，默认 400 */
  width?: number
  /** 卡片是否可滚动（内容多时，如移除市场的级联列表），默认 false */
  scrollable?: boolean
}

export function ConfirmDialog({ title, children, confirmLabel, onConfirm, onClose, width = 400, scrollable = false }: ConfirmDialogProps) {
  const overlayStyle: CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  }
  const cardStyle: CSSProperties = {
    width, background: 'var(--bg)', borderRadius: 'var(--radius)',
    border: '1px solid var(--border)', padding: 20,
    ...(scrollable ? { maxHeight: '80vh', overflow: 'auto' } : {}),
  }
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={cardStyle} onClick={e => e.stopPropagation()}>
        <div style={{ color: 'var(--text)', fontSize: 13, marginBottom: children ? 12 : 16 }}>
          {title}
        </div>
        {children}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '7px 14px', fontSize: 12, cursor: 'pointer', border: 'none', background: 'transparent', color: 'var(--text-muted)' }}>取消</button>
          <button onClick={onConfirm} style={{ padding: '7px 18px', fontSize: 12, cursor: 'pointer', border: 'none', borderRadius: 'var(--radius)', background: 'var(--danger, #e57373)', color: '#fff' }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
