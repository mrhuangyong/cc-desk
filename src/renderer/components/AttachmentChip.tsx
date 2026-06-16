import { Paperclip } from 'lucide-react'
import type { PickedElement } from '../types'

interface Props {
  attachment: PickedElement
  // 可删除态（输入框里用）；消息流里只读不传
  onRemove?: () => void
}

// 拾取附件的可视化 chip：图标 + 简短描述 + 可选删除按钮。
// 输入框内带 × 可删除；消息流内只读。
export function AttachmentChip({ attachment, onRemove }: Props) {
  const label = `网页元素 · ${attachment.tag}`
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '3px 8px', borderRadius: 999,
        background: 'var(--bg-hover)', color: 'var(--text)',
        fontSize: 12, lineHeight: 1.4, maxWidth: '100%',
        border: '1px solid var(--border)'
      }}
      title={`来源: ${attachment.source}\n选择器: ${attachment.selector}`}
    >
      <span aria-hidden style={{ display: 'inline-flex', alignItems: 'center' }}><Paperclip size={13} /></span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label="移除附件"
          title="移除"
          style={{
            fontSize: 13, lineHeight: 1, padding: 0, cursor: 'pointer',
            background: 'transparent', border: 'none', color: 'var(--text-muted)'
          }}
        >×</button>
      )}
    </span>
  )
}
