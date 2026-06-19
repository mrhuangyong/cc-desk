// src/renderer/components/AttachmentChip.tsx
// 草稿附件的可视化 chip：网页元素 / 图片 / 文件。
// 输入框内带 × 可删除；消息流内只读（onRemove 不传）。
import { Paperclip, File as FileIcon, Image as ImageIcon } from 'lucide-react'
import type { DraftAttachment } from '../types'
import { Tooltip } from './Tooltip'

interface Props {
  attachment: DraftAttachment
  onRemove?: () => void
}

export function AttachmentChip({ attachment, onRemove }: Props) {
  let Icon = Paperclip
  let label = ''
  let title = ''
  if (attachment.type === 'pickedElement') {
    Icon = Paperclip
    label = `网页元素 · ${attachment.el.tag}`
    title = `来源: ${attachment.el.source}\n选择器: ${attachment.el.selector}`
  } else if (attachment.type === 'image') {
    Icon = ImageIcon
    label = attachment.name
    title = `图片: ${attachment.name}`
  } else { // file
    Icon = FileIcon
    label = attachment.name
    title = `文件: ${attachment.path}`
  }
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '3px 8px', borderRadius: 999,
        background: 'var(--bg-hover)', color: 'var(--text)',
        fontSize: 12, lineHeight: 1.4, maxWidth: '100%',
        border: '1px solid var(--border)',
      }}
      title={title}
    >
      <span aria-hidden style={{ display: 'inline-flex', alignItems: 'center' }}><Icon size={13} /></span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {onRemove && (
        <Tooltip label="移除">
          <button
            onClick={onRemove}
            aria-label="移除附件"
            title="移除"
            style={{
              fontSize: 13, lineHeight: 1, padding: 0, cursor: 'pointer',
              background: 'transparent', border: 'none', color: 'var(--text-muted)',
            }}
          >×</button>
        </Tooltip>
      )}
    </span>
  )
}
