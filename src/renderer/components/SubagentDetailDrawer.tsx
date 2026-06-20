// 子代理详情抽屉:点击悬浮面板 subagent 行弹出,展示该 subagent 的完整对话输出。
// 复用主流 renderBlocks 渲染 subagentOutputByToolUseId[task.toolUseId]。
// 无遮罩层;从右侧滑入/滑出(transform translateX + transition)。
import { useEffect, useRef, useState } from 'react'
import { X, Bot, Clock, Cpu, Wrench, Terminal } from 'lucide-react'
import type { BackendTask, ContentBlock } from '../types'
import { renderBlocks } from './blocks/BlockRenderer'
import { MarkdownRenderer } from './markdown/MarkdownRenderer'
import { formatSessionTime } from '../utils/formatSessionTime'
import { Tooltip } from './Tooltip'

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
  // 进入/离开动画:open=true 滑入,onClose 时先转 false 滑出,transition 结束后卸载
  const [open, setOpen] = useState(false)
  const closingRef = useRef(false)

  // task 变化驱动动画:
  // - null -> 非null: 重置关闭标志,下一帧滑入
  // - 非null -> 非null(切换 subagent): 重置关闭标志,保持滑入态
  // - 非null -> null: 不渲染,无需处理
  useEffect(() => {
    if (task) {
      closingRef.current = false
      // 下一帧触发滑入(切换 subagent 时若已 open 则无变化,不影响视觉)
      const raf = requestAnimationFrame(() => setOpen(true))
      return () => cancelAnimationFrame(raf)
    }
  }, [task])

  if (!task) return null
  const blocks = (task.toolUseId && outputByToolUseId[task.toolUseId]) || []

  const handleClose = () => {
    if (closingRef.current) return
    closingRef.current = true
    setOpen(false)
    // transition 结束后通知外部卸载(transition .25s,留点余量)
    setTimeout(onClose, 280)
  }

  return (
    <div
      onClick={handleClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', justifyContent: 'flex-end',
        // 背景全透明(无视觉遮罩),但仍接收点击用于「点外部关闭」
        background: 'transparent',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(680px, 90vw)', height: '100%', background: 'var(--bg)',
          borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column',
          boxShadow: 'var(--shadow-float)',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform .25s ease',
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
            <Tooltip label="关闭"><button onClick={handleClose} aria-label="关闭" style={{
              width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)',
              borderRadius: 6,
            }}>
              <X size={16} />
            </button></Tooltip>
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

        {/* 创建该 subagent 的原始 prompt(主流 Task tool_use input.prompt)。
            用 Markdown 渲染：prompt 常含列表/代码块/标题，纯 pre 无法体现结构。 */}
        {task.prompt && (
          <div style={{
            padding: '12px 20px', borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 11, color: 'var(--text-muted)', marginBottom: 6,
              textTransform: 'uppercase', letterSpacing: 0.3,
            }}>
              <Terminal size={11} />
              <span>创建指令</span>
            </div>
            <div style={{
              maxHeight: 320, overflowY: 'auto',
              fontSize: 13, lineHeight: 1.6, color: 'var(--text)',
            }}>
              <MarkdownRenderer text={task.prompt} />
            </div>
          </div>
        )}
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
