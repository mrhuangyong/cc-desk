// src/renderer/components/blocks/ChipView.tsx
// 内联 chip 卡片视觉：FileChip / SkillChip 的 ReactNodeView 共用。
// inline-block、圆角、底色、边框、✕ 删除按钮。
import { File, Sparkles } from 'lucide-react'
import { Tooltip } from '../Tooltip'

interface Props {
  kind: 'file' | 'skill'
  label: string
  onRemove?: () => void
  selected?: boolean
}

export function ChipView({ kind, label, onRemove, selected }: Props) {
  const Icon = kind === 'file' ? File : Sparkles
  return (
    <span
      data-chip={kind}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '1px 6px', borderRadius: 999,
        background: kind === 'skill' ? 'var(--accent-soft, rgba(99,102,241,0.12))' : 'var(--bg-hover)',
        color: 'var(--text)', fontSize: 12, lineHeight: 1.4,
        border: selected ? '1px solid var(--accent)' : '1px solid var(--border)',
        cursor: 'default', userSelect: 'none', margin: '0 1px',
      }}
    >
      <Icon size={12} style={{ flexShrink: 0 }} />
      <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {onRemove && (
        <Tooltip label="移除">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove() }}
            aria-label="移除"
            style={{ fontSize: 12, lineHeight: 1, padding: 0, cursor: 'pointer',
              background: 'transparent', border: 'none', color: 'var(--text-muted)' }}
          >×</button>
        </Tooltip>
      )}
    </span>
  )
}
