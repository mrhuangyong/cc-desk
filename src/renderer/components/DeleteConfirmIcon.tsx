import { useState } from 'react'
import { Trash2, Check } from 'lucide-react'

interface Props {
  onConfirm: () => void
}

export function DeleteConfirmIcon({ onConfirm }: Props) {
  const [confirming, setConfirming] = useState(false)

  if (confirming) {
    return (
      <button
        aria-label="确认删除"
        onClick={(e) => {
          e.stopPropagation()
          onConfirm()
          setConfirming(false)
        }}
        onMouseLeave={() => setConfirming(false)}
        style={{ color: 'var(--danger)', opacity: 0.9, display: 'inline-flex', alignItems: 'center' }}
        title="再次点击确认删除"
      >
        <Check size={14} />
      </button>
    )
  }

  return (
    <button
      aria-label="删除"
      onClick={(e) => {
        e.stopPropagation()
        setConfirming(true)
      }}
      style={{ opacity: 0.6, display: 'inline-flex', alignItems: 'center' }}
      title="删除"
    >
      <Trash2 size={14} />
    </button>
  )
}
