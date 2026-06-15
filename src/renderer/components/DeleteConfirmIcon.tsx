import { useState } from 'react'

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
        style={{ color: 'var(--danger)', opacity: 0.9 }}
        title="再次点击确认删除"
      >
        ✅
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
      style={{ opacity: 0.6 }}
      title="删除"
    >
      🗑️
    </button>
  )
}
