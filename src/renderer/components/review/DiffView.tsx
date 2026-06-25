// 审查 tab：单文件 diff 渲染。复用原 ReviewTab 的 DiffLine 着色逻辑（+绿/-红/@@蓝）。
// diff 文本来自 review.diffCache[selectedPath]（父组件懒加载并缓存）。
import { useMemo } from 'react'

function DiffLine({ line }: { line: string }) {
  let color = 'var(--text-muted)'
  if (line.startsWith('+++') || line.startsWith('---')) color = 'var(--text)'
  else if (line.startsWith('+')) color = '#3fb950'
  else if (line.startsWith('-')) color = '#f85149'
  else if (line.startsWith('@@')) color = '#58a6ff'
  const bg = line.startsWith('+') ? 'rgba(63,185,80,0.08)'
    : line.startsWith('-') ? 'rgba(248,81,73,0.08)'
    : 'transparent'
  return (
    <div style={{ color, background: bg, padding: '0 12px', whiteSpace: 'pre', fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.7 }}>
      {line || ' '}
    </div>
  )
}

interface Props {
  diff: string
  loading: boolean
}

const MAX_RENDER_LINES = 5000   // 超大文件简单截断，阶段 A 不做虚拟化

export function DiffView({ diff, loading }: Props) {
  const { lines, truncated } = useMemo(() => {
    const all = diff.split('\n')
    if (all.length > MAX_RENDER_LINES) {
      return { lines: all.slice(0, MAX_RENDER_LINES), truncated: all.length }
    }
    return { lines: all, truncated: 0 }
  }, [diff])

  if (loading) {
    return <div style={{ padding: 12, color: 'var(--text-muted)' }}>加载 diff…</div>
  }
  if (!diff) {
    return <div style={{ padding: 12, color: 'var(--text-muted)' }}>无差异</div>
  }
  return (
    <div style={{ overflowY: 'auto', padding: '8px 0' }}>
      {lines.map((l, i) => <DiffLine key={i} line={l} />)}
      {truncated > 0 && (
        <div style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: 12 }}>
          （文件过大，仅显示前 {MAX_RENDER_LINES} 行，共 {truncated} 行）
        </div>
      )}
    </div>
  )
}
