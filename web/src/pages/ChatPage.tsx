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
import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { AnyMessage } from '../hooks/useSessionChat'
import type { DialogRequest } from '../lib/dialog-queue'
import type { ChatBlock } from '../lib/chat-blocks'

export interface ChatPageProps {
  title: string
  /** 当前会话的 localSessionId（协议路由键）。会话切换的可靠判据（title 可能重复，如多个"新会话"）。 */
  localSessionId?: string
  messages: AnyMessage[]
  running: boolean
  /** 历史灌入计数（每次 session.history 到达 +1）。变化时强制滚动到底。默认 0。 */
  historyVersion?: number
  /** 可用模型列表（来自桌面端 session.models）。 */
  models?: { id: string; name: string }[]
  /** 当前激活模型 ID。 */
  activeModelId?: string
  /** 切换激活模型（→ session.setActiveModel）。 */
  onSetActiveModel?: (modelId: string) => void
  inputValue: string
  onInputChange: (v: string) => void
  onSend: () => void
  onInterrupt: () => void
  onBack: () => void
  /** 当前挂起的批准请求（队首）；无则不展示卡片。 */
  currentDialog?: DialogRequest | null
  onApprove?: (reqId: string) => void
  onDeny?: (reqId: string) => void
  /** header 右侧额外控件（主题切换等）。 */
  headerExtra?: React.ReactNode
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
    localSessionId,
    messages,
    running,
    historyVersion,
    inputValue,
    onInputChange,
    onSend,
    onInterrupt,
    onBack,
    currentDialog,
    onApprove,
    onDeny,
    headerExtra,
    models,
    activeModelId,
    onSetActiveModel,
  } = props

  const canSend = inputValue.trim().length > 0

  // 自动滚动到底部。
  // 关键时序：进入会话时 messages 为空（历史异步加载），所以不能只在「messages 变化」时滚——
  // 要区分两种场景：
  //   ① 会话切换/历史灌入（historyVersion 变化）：强制滚到底，不看 stick
  //   ② 流式增量/新消息：仅在用户「贴在底部」时跟随，否则不打扰（显示回底按钮）
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [showJumpBottom, setShowJumpBottom] = useState(false)
  // 用户是否「贴在底部」。初始 true（进会话默认贴底）。
  const stickRef = useRef(true)
  // 上一次的会话标题 + 历史版本，用于检测切换/历史到达
  const prevTitleRef = useRef<string>(title)
  const prevHistoryRef = useRef<number>(historyVersion ?? 0)

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = bodyRef.current
    if (!el || typeof el.scrollTo !== 'function') return // jsdom 无 scrollTo，真实浏览器有
    el.scrollTo({ top: el.scrollHeight, behavior })
    stickRef.current = true
    setShowJumpBottom(false)
  }, [])

  // 会话切换：无条件强制滚到底 + 重置贴底判断（对标桌面端 ChatArea 的 [activeSessionId] effect）。
  // 根因修复：原实现仅靠派生 forceBottom + stickRef，但 handleAttach→reset() 不重置这些 refs，
  // 且若用户曾在某会话向上滚过（stickRef=false），重新进入时 forceBottom 读到过期值而不滚动。
  // 这里以 localSessionId 为键独立触发，与「历史到达 forceBottom」「流式 stickRef 跟随」正交，互不干扰。
  // 同步滚动（不用 raf）：切换瞬间立刻定位底部，历史异步到达后由下方 messages effect 二次滚动修正。
  useEffect(() => {
    stickRef.current = true
    setShowJumpBottom(false)
    // 重置切换检测 refs，避免下方 forceBottom effect 在同一会话内重复触发或读到过期值。
    prevTitleRef.current = title
    prevHistoryRef.current = historyVersion ?? 0
    scrollToBottom('auto')
    // 仅以 localSessionId 为依赖：会话切换才触发，title/historyVersion 只用于重置 ref 初值。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localSessionId])

  // 会话切换 或 历史到达：标记需要强制滚（等下面的 messages effect 实际执行）
  const hv = historyVersion ?? 0
  const forceBottom = prevTitleRef.current !== title || prevHistoryRef.current !== hv
  useEffect(() => {
    prevTitleRef.current = title
    prevHistoryRef.current = hv
    if (forceBottom) {
      stickRef.current = true
      setShowJumpBottom(false)
    }
  }, [title, hv, forceBottom])

  // 消息变化时滚动。用 requestAnimationFrame 确保 DOM 已布局（历史灌入后高度才正确）。
  useEffect(() => {
    if (messages.length === 0) return // 空消息不滚
    const raf = requestAnimationFrame(() => {
      if (forceBottom) {
        // 首屏/历史到达/会话切换：强制滚到底
        scrollToBottom('auto')
      } else if (stickRef.current) {
        // 流式增量：仅贴底时跟随
        scrollToBottom('auto')
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [messages, running, forceBottom, scrollToBottom])

  // 滚动监听：判断是否偏离底部（>120px 视为偏离，显示回底按钮）。
  // 注意：内容撑高导致的 scroll 不会触发（只有 scrollTop 变化才触发）；用户主动滚才会。
  const onBodyScroll = useCallback(() => {
    const el = bodyRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    const atBottom = distance < 120
    stickRef.current = atBottom
    setShowJumpBottom(!atBottom)
  }, [])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (canSend) onSend()
    }
  }

  // 批准请求的类型标签（中文化）
  const dialogKindLabel = (kind?: string): string => {
    switch (kind) {
      case 'plan_proposed': return '计划批准'
      case 'permission_request': return '权限请求'
      case 'ask_user_question': return '提问'
      default: return '需要批准'
    }
  }

  return (
    <div className="app chat-page">
      <header className="app-header">
        <button className="icon-btn" onClick={onBack} aria-label="返回">←</button>
        <div className="chat-header-title">
          <h1 className="chat-title">{title || '会话'}</h1>
          {models && models.length > 0 && (
            <select
              className="model-select"
              value={activeModelId || ''}
              onChange={(e) => onSetActiveModel?.(e.target.value)}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          )}
        </div>
        <div className="header-actions">
          {running && (
            <button className="icon-btn stop" onClick={onInterrupt} aria-label="中断">停止</button>
          )}
          {headerExtra}
        </div>
      </header>

      {currentDialog && (
        <div className="dialog-card">
          <div className="dialog-kind">{dialogKindLabel(currentDialog.dialogKind)}</div>
          <div className="dialog-question">
            {currentDialog.dialogKind === 'plan_proposed' ? '是否批准此计划？' : '需要你的确认'}
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

      <main className="chat-body" ref={bodyRef} onScroll={onBodyScroll}>
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

      {showJumpBottom && (
        <button
          className="jump-bottom-btn"
          onClick={() => scrollToBottom('smooth')}
          aria-label="回到底部"
        >
          ↓
        </button>
      )}

      <footer className="chat-input-bar">
        <div className="chat-input-wrap">
          <textarea
            className="chat-input"
            placeholder="输入消息…"
            value={inputValue}
            onChange={(e) => {
              onInputChange(e.target.value)
              // 自适应高度：重置后按 scrollHeight 设定，限制最大高度（CSS max-height 配合）
              const ta = e.target
              ta.style.height = 'auto'
              ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`
            }}
            onKeyDown={onKeyDown}
            rows={1}
          />
          <button
            className="send-icon-btn"
            onClick={onSend}
            disabled={!canSend}
            aria-label="发送"
          >
            {/* 纸飞机图标 */}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </footer>
    </div>
  )
}
