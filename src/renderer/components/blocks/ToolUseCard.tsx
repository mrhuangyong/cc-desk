import { useState } from 'react'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import type { CSSProperties } from 'react'
import { STATUS_COLOR, PULSE_KEYFRAMES, deriveToolStatus, runningGlow } from './tool-status'

// 工具调用卡片：Codex 桌面端风格的紧凑横向行。
// 左侧状态色点 + 工具名（mono）+ 参数摘要，点击展开输入/结果。
// 状态色：running 琥珀脉冲、error 红、success 绿。不用 emoji。

interface Props {
  block: {
    type: 'tool_use'
    id: string
    name: string
    input: any
    status: string
    result?: { content: string; isError: boolean }
  }
  // 在 ToolGroup 内渲染时为 true：去掉自身的 borderTop（组级已提供分隔）。
  inGroup?: boolean
}

const TRUNC_LINES = 30
const TRUNC_CHARS = 2000

export function ToolUseCard({ block, inGroup }: Props) {
  const [open, setOpen] = useState(false)
  const [full, setFull] = useState(false)

  const status = deriveToolStatus(block.status)
  const color = STATUS_COLOR[status]

  const resultText = block.result?.content ?? ''
  const overLong = resultText.length > TRUNC_CHARS || resultText.split('\n').length > TRUNC_LINES
  const shown = !full && overLong
    ? resultText.split('\n').slice(0, TRUNC_LINES).join('\n') + '\n…'
    : resultText

  // 参数摘要：对象取首个有值字段做 preview；字符串截断
  const summarize = (input: any): string => {
    if (input == null) return ''
    if (typeof input === 'string') return input.length > 80 ? input.slice(0, 77) + '…' : input
    if (typeof input === 'object') {
      const entries = Object.entries(input)
      if (entries.length === 0) return ''
      const [k, v] = entries[0]
      const vs = typeof v === 'string' ? v : JSON.stringify(v)
      const vshort = vs.length > 60 ? vs.slice(0, 57) + '…' : vs
      return `${k}: ${vshort}`
    }
    return String(input)
  }
  const summary = summarize(block.input)

  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    cursor: 'pointer',
    padding: '4px 0',
    userSelect: 'none',
  }

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      style={{
        width: '100%',
        margin: inGroup ? '2px 0' : '10px 0',
        padding: 0,
        fontSize: 12,
        fontFamily: 'var(--font-mono)',
      }}
    >
      <summary style={{ ...headerStyle, listStyle: 'none' }}>
        <span
          aria-hidden
          style={{
            width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
            background: color,
            boxShadow: status === 'running' ? runningGlow(color) : 'none',
            animation: status === 'running' ? 'pulse 1.4s ease-in-out infinite' : 'none',
          }}
        />
        <span style={{ color: 'var(--text)', fontWeight: 600, flexShrink: 0 }}>{block.name}</span>
        {summary && (
          <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}>
            {summary}
          </span>
        )}
        {/* 无 summary 时用空 flex 占位，保证箭头始终贴右 */}
        {!summary && <span style={{ flex: 1 }} />}
        {/* 展开提示符 */}
        <span style={{ marginLeft: 'auto', color: 'var(--text-faint)', fontSize: 10 }}>
          {open ? '▾' : '▸'}
        </span>
      </summary>

      {open && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {block.input != null && (
            <div>
              <div style={{ color: 'var(--text-faint)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>输入</div>
              <pre style={{
                margin: 0, padding: 10, background: 'var(--surface-1)', borderRadius: 6,
                overflowX: 'auto', color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                fontSize: 11.5, lineHeight: 1.5,
              }}>
                {typeof block.input === 'string' ? block.input : JSON.stringify(block.input, null, 2)}
              </pre>
            </div>
          )}
          {block.result && (
            <div>
              <div style={{ color: 'var(--text-faint)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>结果</div>
              <div style={{
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                color: block.result.isError ? 'var(--danger)' : 'var(--text)',
                lineHeight: 1.5,
              }}>
                <MarkdownRenderer text={shown} />
              </div>
              {overLong && !full && (
                <button
                  onClick={() => setFull(true)}
                  style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  展开全部 ↓
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <style>{PULSE_KEYFRAMES}</style>
    </details>
  )
}
