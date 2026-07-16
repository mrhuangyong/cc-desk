// 子代理内嵌卡片：在对话流中渲染 Task 工具（subagent）的完整三要素——
// ① 创建指令（block.input.prompt / description）
// ② 执行过程（subagent 自己的 text/thinking/tool_use/tool_result，来自 subagentOutputByToolUseId）
// ③ 最终结果（block.result，主流 tool_result 回填，持久化）
//
// 运行中的 subagent 仍在悬浮面板显示（实时进度），完成（status≠running）后才解除隐藏
// 在对话流渲染本卡片。三要素数据源不同：创建参数+结果在主流 messages（持久化），
// 过程在 subagentOutputByToolUseId（内存态，刷新会丢，与抽屉现状一致）。
//
// 复用 ToolUseCard 的 details/summary 折叠交互 + tool-status 颜色三件套，
// 视觉与普通工具卡一致，仅内容结构不同。
import { useState, type CSSProperties } from 'react'
import { Bot } from 'lucide-react'
import type { ContentBlock } from '../../types'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import { renderBlocks } from './BlockRenderer'
import { STATUS_COLOR, PULSE_KEYFRAMES, deriveToolStatus, runningGlow } from './tool-status'

type ToolBlock = Extract<ContentBlock, { type: 'tool_use' }>

const TRUNC_LINES = 30
const TRUNC_CHARS = 2000

interface Props {
  block: ToolBlock
  // 该 subagent 累积的过程块（text/thinking/tool_use/tool_result），按 toolUseId 索引
  output?: ContentBlock[]
  showThinking?: boolean
  // 测试/外部场景强制初始展开（jsdom 不自动翻转 <details> open，故暴露入口）
  defaultOpen?: boolean
}

export function SubagentInlineCard({ block, output, showThinking = true, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const [full, setFull] = useState(false)

  const status = deriveToolStatus(block.status)
  const color = STATUS_COLOR[status]

  const input = block.input || {}
  // 头部摘要：description 优先，其次 subagent_type，回退占位
  const summary =
    (typeof input.description === 'string' && input.description) ||
    (typeof input.subagent_type === 'string' && input.subagent_type) ||
    '子代理任务'

  const prompt =
    typeof input.prompt === 'string' && input.prompt
      ? input.prompt
      : (typeof input.subagent_type === 'string' ? `（subagent_type: ${input.subagent_type}）` : '')

  const resultText = block.result?.content ?? ''
  const overLong = resultText.length > TRUNC_CHARS || resultText.split('\n').length > TRUNC_LINES
  const shownResult = !full && overLong
    ? resultText.split('\n').slice(0, TRUNC_LINES).join('\n') + '\n…'
    : resultText

  const headerStyle: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8,
    cursor: 'pointer', padding: '4px 0', userSelect: 'none',
  }

  const sectionLabelStyle: CSSProperties = {
    color: 'var(--text-faint)', fontSize: 10,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4,
  }

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      style={{ width: '100%', margin: '10px 0', padding: 0, fontSize: 12, fontFamily: 'var(--font-mono)' }}
    >
      <summary style={{ ...headerStyle, listStyle: 'none' }}>
        <span aria-hidden style={{
          width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
          background: color,
          boxShadow: status === 'running' ? runningGlow(color) : 'none',
          animation: status === 'running' ? 'pulse 1.4s ease-in-out infinite' : 'none',
        }} />
        <Bot size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <span style={{ color: 'var(--text)', fontWeight: 600, flexShrink: 0 }}>{summary}</span>
        <span style={{ marginLeft: 'auto', color: 'var(--text-faint)', fontSize: 10 }}>{open ? '▾' : '▸'}</span>
      </summary>

      {open && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* 创建指令 */}
          {prompt && (
            <div>
              <div style={sectionLabelStyle}>创建指令</div>
              <div style={{
                maxHeight: 320, overflowY: 'auto',
                fontSize: 13, lineHeight: 1.6, color: 'var(--text)',
                background: 'var(--surface-1)', borderRadius: 6, padding: 10,
              }}>
                <MarkdownRenderer text={prompt} />
              </div>
            </div>
          )}

          {/* 执行过程：subagent 自己的工具调用记录 */}
          <div>
            <div style={sectionLabelStyle}>执行过程</div>
            {output && output.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {renderBlocks(output, true, undefined, undefined, showThinking)}
              </div>
            ) : (
              <div style={{ color: 'var(--text-faint)', fontSize: 11.5, padding: '6px 0' }}>
                （执行过程的工具调用记录将在子代理运行时显示，刷新页面后不保留）
              </div>
            )}
          </div>

          {/* 最终结果 */}
          {block.result && (
            <div>
              <div style={sectionLabelStyle}>最终结果</div>
              <div style={{
                wordBreak: 'break-word',
                color: block.result.isError ? 'var(--danger)' : 'var(--text)',
                lineHeight: 1.5,
              }}>
                <MarkdownRenderer text={shownResult} />
              </div>
              {overLong && !full && (
                <button onClick={() => setFull(true)} style={{
                  marginTop: 6, fontSize: 11, color: 'var(--text-muted)',
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                }}>
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
