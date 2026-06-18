import { useState } from 'react'
import { Trash2, Archive, Check } from 'lucide-react'
import type { CSSProperties } from 'react'

interface Props {
  onConfirm: () => void
  /** 触发图标：archive 归档（默认）、delete 删除 */
  variant?: 'archive' | 'delete'
}

// 二次确认图标按钮：第一次点击进入确认态（显示 ✓/✗），第二次点 ✓ 执行。
// 用于会话归档、项目/会话删除等不可逆操作的轻量确认。
export function DeleteConfirmIcon({ onConfirm, variant = 'archive' }: Props) {
  const [confirming, setConfirming] = useState(false)
  const isDelete = variant === 'delete'
  const Icon = isDelete ? Trash2 : Archive
  const actionLabel = isDelete ? '删除' : '归档'

  if (confirming) {
    return (
      <button
        onMouseLeave={() => setConfirming(false)}
        aria-label={`确认${actionLabel}`}
        onClick={(e) => { e.stopPropagation(); onConfirm(); setConfirming(false) }}
        title={`再次点击确认${actionLabel}`}
        style={confirmBtnStyle(isDelete)}
      >
        <Check size={14} />
      </button>
    )
  }

  return (
    <button
      aria-label={actionLabel}
      onClick={(e) => { e.stopPropagation(); setConfirming(true) }}
      title={actionLabel}
      style={idleBtnStyle}
    >
      <Icon size={14} />
    </button>
  )
}

const idleBtnStyle: CSSProperties = {
  opacity: 0.6, display: 'inline-flex', alignItems: 'center',
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--text-muted)', padding: '2px', lineHeight: 1,
}

function confirmBtnStyle(isDelete: boolean): CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    padding: '2px 4px', lineHeight: 1,
    background: isDelete ? 'rgba(255,59,48,0.12)' : 'var(--bg-hover)',
    border: `1px solid ${isDelete ? 'rgba(255,59,48,0.4)' : 'var(--border)'}`,
    borderRadius: 4, cursor: 'pointer',
    color: isDelete ? '#ff3b30' : 'var(--accent)',
  }
}
