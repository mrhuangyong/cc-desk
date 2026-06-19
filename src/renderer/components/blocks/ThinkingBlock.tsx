import { useState } from 'react'
import { Brain, ChevronRight } from 'lucide-react'

// 思考过程块：Codex 式折叠行，左侧 Brain 图标，默认折叠。
export function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{
      margin: '10px 0',
      fontSize: 12,
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          width: '100%', padding: 0, cursor: 'pointer',
          background: 'transparent', border: 'none', color: 'var(--text-muted)',
          fontFamily: 'var(--font-mono)', fontSize: 12,
        }}
      >
        <Brain size={13} style={{ flexShrink: 0, opacity: 0.7 }} />
        <span>思考过程</span>
        <ChevronRight size={12} style={{
          flexShrink: 0,
          transition: 'transform .15s',
          transform: open ? 'rotate(90deg)' : 'none',
        }} />
      </button>
      {open && (
        <div style={{
          marginTop: 8, padding: 10, whiteSpace: 'pre-wrap',
          background: 'var(--surface-1)', borderRadius: 6,
          color: 'var(--text-muted)', lineHeight: 1.6, fontFamily: 'var(--font-mono)',
        }}>
          {text}
        </div>
      )}
    </div>
  )
}
