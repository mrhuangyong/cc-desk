import { useState } from 'react'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'

const TRUNC_LINES = 30
const TRUNC_CHARS = 2000

export function ToolUseCard({ block }: {
  block: { type: 'tool_use'; id: string; name: string; input: any; status: string; result?: { content: string; isError: boolean } }
}) {
  const [open, setOpen] = useState(false)
  const [full, setFull] = useState(false)
  const resultText = block.result?.content ?? ''
  const overLong = resultText.length > TRUNC_CHARS || resultText.split('\n').length > TRUNC_LINES
  const shown = !full && overLong ? resultText.split('\n').slice(0, TRUNC_LINES).join('\n') + '\n…' : resultText
  const summary = `${block.name} ${typeof block.input === 'object' ? JSON.stringify(block.input).slice(0, 60) : ''}`
  const dot = block.status === 'running' ? '🟡' : block.status === 'error' ? '🔴' : '🟢'
  return (
    <details open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
      <summary style={{ cursor: 'pointer' }}>{dot} {summary}</summary>
      <div style={{ marginTop: 6 }}>
        <div style={{ color: 'var(--text-muted)' }}>输入：{JSON.stringify(block.input, null, 2)}</div>
        {block.result && (
          <div style={{ marginTop: 6, whiteSpace: 'pre-wrap', color: block.result.isError ? '#ef4444' : 'var(--text)' }}>
            <MarkdownRenderer text={shown} />
          </div>
        )}
        {overLong && !full && (
          <button onClick={() => setFull(true)} style={{ fontSize: 11, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>展开查看全部</button>
        )}
      </div>
    </details>
  )
}
