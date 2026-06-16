import { useEffect, useRef } from 'react'
import { useStore } from '../state/store'
import { AttachmentChip } from './AttachmentChip'
import { InputBar } from './InputBar'

export function ChatArea() {
  const { state, dispatch } = useStore()

  // 找当前会话
  const session = state.projects
    .flatMap(p => p.sessions)
    .find(s => s.id === state.activeSessionId)

  // 当前会话的流式状态（增量拼接的临时文本）
  const streaming = state.streamingBySession[state.activeSessionId]

  // 流式文本的 ref：STREAM_END 时主进程只回传元数据（cost/duration），
  // 真正的文本已通过 delta 累积在这里，用 ref 在 effect 闭包里读取最新值。
  const streamingRef = useRef('')
  useEffect(() => {
    streamingRef.current = streaming?.currentText || ''
  }, [streaming?.currentText])

  // 注册 IPC 监听器：流式增量 / 结束 / 错误 / 中止
  useEffect(() => {
    const api = window.api?.claude
    if (!api) return

    api.onStreamDelta(({ delta }) => {
      dispatch({ type: 'STREAM_DELTA', sessionId: state.activeSessionId, delta })
    })
    api.onResult((data) => {
      dispatch({
        type: 'STREAM_END',
        sessionId: data.sessionId || state.activeSessionId,
        content: [{ type: 'text', text: streamingRef.current || '' }],
        costUSD: data.costUSD,
        durationMs: data.durationMs,
      })
    })
    api.onError(({ error }) => {
      dispatch({ type: 'STREAM_ERROR', sessionId: state.activeSessionId, error })
    })
    api.onAborted(() => {
      dispatch({ type: 'STREAM_ABORTED', sessionId: state.activeSessionId })
    })

    return () => api.removeAllListeners()
  }, [state.activeSessionId, dispatch])

  if (!session) {
    return <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--text-muted)' }}>无选中会话</div>
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--bg)' }}>
      {/* 闪烁光标动画 */}
      <style>{`@keyframes blink { 50% { opacity: 0 } }`}</style>
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {session.messages.length === 0 && !streaming?.isStreaming && (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: 60 }}>开始新的对话</div>
        )}
        {session.messages.map(m => (
          m.role === 'assistant' ? (
            // AI 消息：左对齐，纯文本无背景
            <div key={m.id} style={{
              maxWidth: '80%', alignSelf: 'flex-start',
              color: 'var(--text)',
              display: 'flex', flexDirection: 'column', gap: 6
            }}>
              {m.attachment && <AttachmentChip attachment={m.attachment} />}
              {m.content && <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>}
            </div>
          ) : (
            // 用户消息：右对齐，浅灰块
            <div key={m.id} style={{
              maxWidth: '80%', alignSelf: 'flex-end',
              background: 'var(--bg-hover)', borderRadius: 10, padding: '9px 13px',
              color: 'var(--text)',
              display: 'flex', flexDirection: 'column', gap: 6
            }}>
              {m.attachment && <AttachmentChip attachment={m.attachment} />}
              {m.content && <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>}
            </div>
          )
        ))}
        {/* 流式消息：增量文本 + 闪烁光标 */}
        {streaming?.isStreaming && (
          <div style={{ color: 'var(--text)', fontSize: 14, lineHeight: 1.6, padding: '0 28px' }}>
            {streaming.currentText}
            <span style={{ animation: 'blink 1s step-end infinite' }}>▌</span>
          </div>
        )}
        {/* 错误提示 */}
        {streaming?.error && (
          <div style={{ color: '#ef4444', fontSize: 13, padding: '0 28px' }}>
            ❌ {streaming.error}
          </div>
        )}
      </div>
      <div style={{ padding: '0 28px 20px' }}>
        <InputBar />
      </div>
    </div>
  )
}
