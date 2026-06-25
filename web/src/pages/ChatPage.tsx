// web/src/pages/ChatPage.tsx
// PWA 对话页（Task 14）。
//
// 职责：
//   - 渲染消息序列（user / assistant）：assistant 文本走最简 markdown（粗体/行内代码/换行），
//     不引入 remark/shiki 等重依赖（Musk Algorithm：能不引就不引，手机端首屏体积敏感）。
//   - 渲染 assistant 消息的 blocks（tool_use / tool_result / plan 计划卡片）。
//   - 底部输入框 → onSend（→ session.message）；中断按钮 → onInterrupt（→ session.interrupt）。
//   - 顶部批准卡片（current dialog）→ onApprove/onDeny（→ dialog.response）。
//
// 数据由父组件（App）通过 useSessionChat / useDialogQueue 聚合后以 props 注入；
//   本页只做渲染 + 回调，传输/状态机在 hook 层（便于测试）。
import React from 'react'
import type { AnyMessage } from '../hooks/useSessionChat'
import type { DialogRequest } from '../lib/dialog-queue'
import type { ChatBlock } from '../lib/chat-blocks'

export interface ChatPageProps {
  title: string
  messages: AnyMessage[]
  running: boolean
  inputValue: string
  onInputChange: (v: string) => void
  onSend: () => void
  onInterrupt: () => void
  onBack: () => void
  /** 当前挂起的批准请求（队首）；无则不展示卡片。 */
  currentDialog?: DialogRequest | null
  onApprove?: (reqId: string) => void
  onDeny?: (reqId: string) => void
}

/**
 * 最简行内 markdown 渲染（粗体 **x** + 行内代码 `x`）。
 * 不引依赖：手机端首屏体积敏感，复杂 markdown 待后续按需引入。
 * 仅处理行内格式，换行交给 CSS white-space: pre-wrap。
 */
function renderInline(text: string): React.ReactNode[] {
  // 先按 ** 拆粗体，再对每段按 ` 拆行内代码。
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  const out: React.ReactNode[] = []
  parts.forEach((seg, i) => {
    if (!seg) return
    if (seg.startsWith('**') && seg.endsWith('**') && seg.length > 4) {
      out.push(<strong key={`b${i}`}>{seg.slice(2, -2)}</strong>)
      return
    }
    // 行内代码
    const codeParts = seg.split(/(`[^`]+`)/g)
    codeParts.forEach((c, j) => {
      if (!c) return
      if (c.startsWith('`') && c.endsWith('`') && c.length > 2) {
        out.push(<code key={`c${i}-${j}`}>{c.slice(1, -1)}</code>)
        return
      }
      out.push(<React.Fragment key={`t${i}-${j}`}>{c}</React.Fragment>)
    })
  })
  return out
}

function BlockView({ block }: { block: ChatBlock }) {
  if (block.kind === 'plan') {
    return <div className="block plan-card">📋 计划</div>
  }
  if (block.kind === 'tool_use') {
    return <div className="block tool-use">🔧 {block.label}</div>
  }
  if (block.kind === 'tool_result') {
    return <div className="block tool-result">✓ 结果</div>
  }
  return null
}

export default function ChatPage(props: ChatPageProps) {
  const {
    title,
    messages,
    running,
    inputValue,
    onInputChange,
    onSend,
    onInterrupt,
    onBack,
    currentDialog,
    onApprove,
    onDeny,
  } = props

  const canSend = inputValue.trim().length > 0

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (canSend) onSend()
    }
  }

  return (
    <div className="chat-page">
      <header className="app-header">
        <button className="icon-btn" onClick={onBack} aria-label="返回">←</button>
        <h1 className="chat-title">{title || '会话'}</h1>
        {running && (
          <button className="icon-btn stop" onClick={onInterrupt} aria-label="中断">停止</button>
        )}
      </header>

      {currentDialog && (
        <div className="dialog-card">
          <div className="dialog-question">
            {currentDialog.dialogKind === 'plan_proposed' ? '是否批准此计划？' : '需要批准'}
          </div>
          <div className="dialog-actions">
            <button
              className="dialog-btn approve"
              onClick={() => onApprove?.(currentDialog.reqId)}
            >
              批准
            </button>
            <button
              className="dialog-btn deny"
              onClick={() => onDeny?.(currentDialog.reqId)}
            >
              拒绝
            </button>
          </div>
        </div>
      )}

      <main className="chat-body">
        {messages.length === 0 && (
          <p className="hint chat-empty">还没有消息，输入开始对话</p>
        )}
        {messages.map((m, i) => {
          if (m.role === 'user') {
            return (
              <div key={i} className="msg user">
                <div className="msg-bubble user-bubble">{m.text}</div>
              </div>
            )
          }
          return (
            <div key={i} className="msg assistant">
              <div className="msg-bubble assistant-bubble">
                {m.thinking && (
                  <details className="thinking">
                    <summary>思考</summary>
                    <div className="thinking-text">{m.thinking}</div>
                  </details>
                )}
                {m.text && <div className="assistant-text">{renderInline(m.text)}</div>}
                {m.blocks.map((b, j) => (
                  <BlockView key={j} block={b} />
                ))}
                {running && !m.text && m.blocks.length === 0 && !m.thinking && (
                  <span className="typing">…</span>
                )}
              </div>
            </div>
          )
        })}
      </main>

      <footer className="chat-input-bar">
        <textarea
          className="chat-input"
          placeholder="输入消息…"
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
        />
        <button
          className="send-btn"
          onClick={onSend}
          disabled={!canSend}
          aria-label="发送"
        >
          发送
        </button>
      </footer>
    </div>
  )
}
