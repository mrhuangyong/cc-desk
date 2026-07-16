// 子代理详情抽屉:点击悬浮面板 subagent 行弹出,展示该 subagent 的完整对话输出。
// 复用主流 renderBlocks 渲染 subagentOutputByToolUseId[task.toolUseId]。
// 滑入动画/外壳由 Drawer 提供（与 TaskDetailDrawer 共用）。
import { X, Bot, Clock, Cpu, Wrench, Terminal } from 'lucide-react'
import type { BackendTask, ContentBlock } from '../types'
import { renderBlocks } from './blocks/BlockRenderer'
import { MarkdownRenderer } from './markdown/MarkdownRenderer'
import { formatSessionTime } from '../utils/formatSessionTime'
import { fmtTokens, fmtDuration } from '../utils/format'
import { Tooltip } from './Tooltip'
import { Drawer } from './Drawer'
import { useStore } from '../state/store'

interface Props {
  task: BackendTask | null
  // 该 subagent 的累积对话输出(按 toolUseId 索引)
  outputByToolUseId: Record<string, ContentBlock[]>
  onClose: () => void
}

export function SubagentDetailDrawer({ task, outputByToolUseId, onClose }: Props) {
  const showThinking = useStore().state.settings.showThinking
  if (!task) return null
  const blocks = (task.toolUseId && outputByToolUseId[task.toolUseId]) || []

  // 最终结果：从主流 messages 找该 Task tool_use 的 result（走 STREAM_TOOL_RESULT 回填，持久化）。
  // 抽屉原本只有「过程」（subagentOutputByToolUseId），缺最终结果；这里补齐三要素。
  const state = useStore().state
  let finalResult: { content: string; isError: boolean } | undefined
  if (task.toolUseId && task.localSessionId) {
    const session = state.projects
      ?.flatMap((p: any) => p.sessions ?? [])
      ?.find((s: any) => s.id === task.localSessionId)
    const msgs = session?.messages ?? []
    outer: for (const m of msgs) {
      for (const c of (m.content ?? [])) {
        if (c?.type === 'tool_use' && c.id === task.toolUseId) {
          if (c.result) finalResult = { content: c.result.content ?? '', isError: !!c.result.isError }
          break outer
        }
      }
    }
  }

  return (
    <Drawer trigger={task} onClose={onClose} width="min(680px, 90vw)">
      {(handleClose) => (
        <>
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
          {/* 对话输出区:可滚动（过程 + 最终结果） */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
            {blocks.length === 0 && !finalResult ? (
              <div style={{ color: 'var(--text-faint)', fontSize: 12, padding: '24px 0', textAlign: 'center' }}>
                暂无输出(子代理刚启动或尚未产生消息)
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {blocks.length > 0 && (
                  <div>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      fontSize: 11, color: 'var(--text-muted)', marginBottom: 6,
                      textTransform: 'uppercase', letterSpacing: 0.3,
                    }}>
                      <Wrench size={11} />
                      <span>执行过程</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {renderBlocks(blocks, undefined, undefined, undefined, showThinking)}
                    </div>
                  </div>
                )}
                {finalResult && (
                  <div>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      fontSize: 11, color: 'var(--text-muted)', marginBottom: 6,
                      textTransform: 'uppercase', letterSpacing: 0.3,
                    }}>
                      <Terminal size={11} />
                      <span>最终结果</span>
                    </div>
                    <div style={{
                      wordBreak: 'break-word',
                      color: finalResult.isError ? 'var(--danger)' : 'var(--text)',
                      lineHeight: 1.5,
                    }}>
                      <MarkdownRenderer text={finalResult.content} />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </Drawer>
  )
}
