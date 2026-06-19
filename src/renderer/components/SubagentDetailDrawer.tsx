// 子代理详情抽屉:点击悬浮面板 subagent 行弹出,展示该 subagent 的完整对话输出。
// 复用主流 renderBlocks 渲染 subagentOutputByToolUseId[task.toolUseId]。
// 浮层风格对齐 McpEditDialog:position:fixed + rgba 遮罩 + zIndex:1000。
import { X, Bot, Clock, Cpu, Wrench } from 'lucide-react'
import type { BackendTask, ContentBlock } from '../types'
import { renderBlocks } from './blocks/BlockRenderer'
import { formatSessionTime } from '../utils/formatSessionTime'

interface Props {
  task: BackendTask | null
  // 该 subagent 的累积对话输出(按 toolUseId 索引)
  outputByToolUseId: Record<string, ContentBlock[]>
  onClose: () => void
}

function fmtDuration(ms?: number): string {
  if (!ms) return '-'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

function fmtTokens(n?: number): string {
  if (!n) return '-'
  if (n < 1000) return `${n}`
  return `${(n / 1000).toFixed(1)}k`
}

export function SubagentDetailDrawer({ task, outputByToolUseId, onClose }: Props) {
  if (!task) return null
  const blocks = (task.toolUseId && outputByToolUseId[task.toolUseId]) || []

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
        display: 'flex', justifyContent: 'flex-end',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(680px, 90vw)', height: '100%', background: 'var(--bg)',
          borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column',
          boxShadow: 'var(--shadow-float)',
        }}
      >
        {/* 头部:标题 + 进度元信息 + 关闭 */}
        <div style={{
          padding: '14px 20px', borderBottom: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text)', fontWeight: 600, fontSize: 14 }}>
              <Bot size={16} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 460 }}>
                {task.command}
              </span>
            </div>
            <button onClick={onClose} title="关闭" aria-label="关闭" style={{
              width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)',
              borderRadius: 6,
            }}>
              <X size={16} />
            </button>
          </div>
          {/* 进度元信息条 */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-muted)' }}>
            {task.subagentType && <span style={{ background: 'var(--surface-2)', padding: '1px 6px', borderRadius: 3 }}>{task.subagentType}</span>}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Clock size={11} /> {fmtDuration(task.durationMs)}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Cpu size={11} /> {fmtTokens(task.tokenCount)} tokens</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Wrench size={11} /> {task.toolUses ?? 0} 工具</span>
            {task.lastToolName && <span>最近: {task.lastToolName}</span>}
            <span>· 开始 {formatSessionTime(task.startedAt)}</span>
          </div>
          {/* 进度摘要 */}
          {task.progressSummary && (
            <div style={{ fontSize: 12, color: 'var(--text)', background: 'var(--surface-1)', padding: '6px 10px', borderRadius: 6, lineHeight: 1.5 }}>
              {task.progressSummary}
            </div>
          )}
        </div>

        {/* 对话输出区:可滚动 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {blocks.length === 0 ? (
            <div style={{ color: 'var(--text-faint)', fontSize: 12, padding: '24px 0', textAlign: 'center' }}>
              暂无输出(子代理刚启动或尚未产生消息)
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {renderBlocks(blocks)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
