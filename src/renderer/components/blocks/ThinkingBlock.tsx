import { useState } from 'react'

export function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <details open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      style={{ color: 'var(--text-muted)', fontSize: 12, borderLeft: '2px solid var(--border)', paddingLeft: 10 }}>
      <summary style={{ cursor: 'pointer' }}>思考过程</summary>
      <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{text}</div>
    </details>
  )
}
