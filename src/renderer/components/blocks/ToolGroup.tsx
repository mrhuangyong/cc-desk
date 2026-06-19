import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { ContentBlock } from '../../types'
import { ToolUseCard } from './ToolUseCard'

// 连续工具调用分组：把相邻的 tool_use block 聚成一个整体可折叠的组。
// 组级 header 显示工具数量 + 整体状态（进行中/有错误/全部完成），
// 默认折叠，展开后逐个渲染 ToolUseCard（每项仍可单独展开）。
//
// 设计：单条 tool_use 仍走单个 ToolUseCard（不分组），避免把孤立工具调用
// 也包一层。分组门槛：连续 2 条及以上 tool_use 才聚合。

type ToolBlock = Extract<ContentBlock, { type: 'tool_use' }>

type GroupStatus = 'running' | 'error' | 'done'

export function ToolGroup({ tools }: { tools: ToolBlock[] }) {
  const [open, setOpen] = useState(false)

  // 整体状态：任一 running → running；任一 error 且无 running → error；否则 done
  const groupStatus: GroupStatus = tools.some(t => t.status === 'running')
    ? 'running'
    : tools.some(t => t.status === 'error')
      ? 'error'
      : 'done'

  const STATUS_COLOR: Record<GroupStatus, string> = {
    running: 'var(--status-warn, #d97706)',
    error: 'var(--danger)',
    done: 'var(--status-ok, #16a34a)',
  }
  const color = STATUS_COLOR[groupStatus]

  return (
    <div style={{ margin: '10px 0' }}>
      {/* 组级 header：可点击整体折叠/展开 */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          padding: '8px 0', cursor: 'pointer', userSelect: 'none',
          background: 'transparent', border: 'none', color: 'var(--text)',
          fontFamily: 'var(--font-mono)', fontSize: 12,
        }}
      >
        <ChevronRight size={13} style={{
          flexShrink: 0, color: 'var(--text-muted)',
          transition: 'transform .15s', transform: open ? 'rotate(90deg)' : 'none',
        }} />
        <span
          aria-hidden
          style={{
            width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: color,
            boxShadow: groupStatus === 'running' ? `0 0 0 3px ${hexToRgba(color, 0.18)}` : 'none',
            animation: groupStatus === 'running' ? 'pulse 1.4s ease-in-out infinite' : 'none',
          }}
        />
        <span style={{ fontWeight: 600 }}>{tools.length} 个工具调用</span>
        <span style={{ flex: 1 }} />
      </button>

      {/* 展开后：逐个渲染工具卡 */}
      {open && (
        <div>
          {tools.map((t, i) => (
            <ToolUseCard key={t.id ?? i} block={t} inGroup />
          ))}
        </div>
      )}

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.35} }`}</style>
    </div>
  )
}

// 把 #rrggbb 转成 rgba（用于 running 态光晕）。非 # 格式原样返回。
function hexToRgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-fa-f]{6})$/.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return `rgba(${r},${g},${b},${alpha})`
}
