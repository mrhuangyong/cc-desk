import { useEffect, useRef } from 'react'
import { useStore } from '../state/store'
import { useI18n } from '../i18n/useI18n'
import { AttachmentChip } from './AttachmentChip'
import { InputBar } from './InputBar'

export function ChatArea() {
  const { state, dispatch } = useStore()
  const { t } = useI18n()

  // 找当前会话
  const session = state.projects
    .flatMap(p => p.sessions)
    .find(s => s.id === state.activeSessionId)

  // 当前会话的流式状态（增量拼接的 blocks/notices）
  const streaming = state.streamingBySession[state.activeSessionId]

  // 监听器只在挂载时注册一次，回调内需要的"会变值"通过 ref 取最新值，
  // 避免因依赖数组变化而 removeAllListeners→重注册，造成 claude:result 事件丢失、
  // STREAM_END 不派发、isStreaming 永久卡死的竞态。
  const activeSessionIdRef = useRef(state.activeSessionId)
  const settingsRef = useRef(state.settings)
  useEffect(() => { activeSessionIdRef.current = state.activeSessionId }, [state.activeSessionId])
  useEffect(() => { settingsRef.current = state.settings }, [state.settings])

  // 注册 IPC 监听器：归一化后的新通道（delta/blocks/notice/result/error/aborted）
  useEffect(() => {
    const api = window.api?.claude
    if (!api) return

    // 捕获 Claude 返回的真实 sessionId，建立 localSessionId → claudeSessionId 映射，供后续消息 resume 续接
    api.onSystem((data: any) => {
      if (data?.sessionId) {
        dispatch({
          type: 'SET_CLAUDE_SESSION_ID',
          localSessionId: activeSessionIdRef.current,
          claudeSessionId: data.sessionId,
        })
      }
    })
    // 增量文本/思考
    api.onDelta(({ kind, delta }) => {
      dispatch({ type: 'STREAM_DELTA', sessionId: activeSessionIdRef.current, kind, delta })
    })
    // 归一化 blocks：工具开始 / assistant 整块 / 工具结果
    api.onBlocks((data: any) => {
      if (data?.op === 'tool_use_start') {
        dispatch({
          type: 'STREAM_TOOL_USE_START',
          sessionId: activeSessionIdRef.current,
          block: data.block,
        })
      } else if (data?.op === 'assistant_blocks') {
        dispatch({
          type: 'STREAM_ASSISTANT_BLOCKS',
          sessionId: activeSessionIdRef.current,
          blocks: data.blocks,
          uuid: data.uuid,
        })
      } else if (data?.op === 'tool_result') {
        dispatch({
          type: 'STREAM_TOOL_RESULT',
          sessionId: activeSessionIdRef.current,
          toolUseId: data.toolUseId,
          result: data.result,
        })
      }
    })
    // 系统通知（状态/权限/压缩/重试/任务/错误等）
    api.onNotice((notice: any) => {
      dispatch({ type: 'STREAM_NOTICE', sessionId: activeSessionIdRef.current, notice })
    })
    api.onResult((data: any) => {
      dispatch({
        type: 'STREAM_END',
        // 始终用本地 activeSessionId：streamingBySession 的 key 是本地 id。
        sessionId: activeSessionIdRef.current,
        costUSD: data.costUSD,
        durationMs: data.durationMs,
        turns: data.turns,
        isError: data.isError,
      })
      // 任务通知：任务完成时发桌面通知（受常规设置 taskNotify 控制）
      const s = settingsRef.current
      if (s.taskNotify && 'Notification' in window) {
        const n = new Notification(t('chat.taskDone'), { body: t('chat.taskDoneBody'), silent: !s.notifySound })
        n.onclick = () => window.focus()
      }
    })
    api.onError(({ error }) => {
      dispatch({ type: 'STREAM_ERROR', sessionId: activeSessionIdRef.current, error })
    })
    api.onAborted(() => {
      dispatch({ type: 'STREAM_ABORTED', sessionId: activeSessionIdRef.current })
    })

    return () => api.removeAllListeners()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])


  if (!session) {
    return <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--text-muted)' }}>{t('chat.noSession')}</div>
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--bg)' }}>
      {/* 闪烁光标动画 */}
      <style>{`@keyframes blink { 50% { opacity: 0 } }`}</style>
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {session.messages.length === 0 && !streaming && (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: 60 }}>{t('chat.empty')}</div>
        )}
        {session.messages.map(m => (
          m.role === 'assistant' ? (
            // AI 消息：左对齐，纯文本无背景
            <div key={m.id} style={{
              maxWidth: '80%', alignSelf: 'flex-start',
              color: 'var(--text)',
              display: 'flex', flexDirection: 'column', gap: 6,
              userSelect: 'text', cursor: 'text',
            }}>
              {m.attachment && <AttachmentChip attachment={m.attachment} />}
              {(() => {
                const text = m.content.filter(b => b.type === 'text').map((b:any) => b.text).join('')
                return text && <div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>
              })()}
            </div>
          ) : (
            // 用户消息：右对齐，浅灰块
            <div key={m.id} style={{
              maxWidth: '80%', alignSelf: 'flex-end',
              background: 'var(--bg-hover)', borderRadius: 10, padding: '9px 13px',
              color: 'var(--text)',
              display: 'flex', flexDirection: 'column', gap: 6,
              userSelect: 'text', cursor: 'text',
            }}>
              {m.attachment && <AttachmentChip attachment={m.attachment} />}
              {(() => {
                const text = m.content.filter(b => b.type === 'text').map((b:any) => b.text).join('')
                return text && <div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>
              })()}
            </div>
          )
        ))}
        {/* 流式消息：思考过程 + 工具卡片 + 增量文本 + 闪烁光标 */}
        {streaming && (() => {
          const blocks = streaming.blocks || []
          const thinking = (blocks.filter(b => b.type === 'thinking').map((b: any) => b.text).join('')) as string
          const currentText = (blocks.filter(b => b.type === 'text').map((b: any) => b.text).join('')) as string
          const tools = blocks.filter(b => b.type === 'tool_use') as { id: string; name: string }[]
          return (
          <div style={{ color: 'var(--text)', fontSize: 14, lineHeight: 1.6, padding: '0 28px', display: 'flex', flexDirection: 'column', gap: 8, userSelect: 'text' }}>
            {/* 显示思考过程（受常规设置 showThinking 控制） */}
            {state.settings.showThinking && thinking && (
              <details style={{ color: 'var(--text-muted)', fontSize: 12, borderLeft: '2px solid var(--border)', paddingLeft: 10 }}>
                <summary style={{ cursor: 'pointer' }}>{t('chat.thinking')}</summary>
                <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{thinking}</div>
              </details>
            )}
            {/* 显示待办/工具卡片（受常规设置 showTodo 控制） */}
            {state.settings.showTodo && tools.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {tools.map((tl, i) => (
                  <span key={`${tl.id}-${i}`} style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, background: 'var(--bg-hover)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    🔧 {tl.name}
                  </span>
                ))}
              </div>
            )}
            {currentText}
            <span style={{ animation: 'blink 1s step-end infinite' }}>▌</span>
          </div>
          )
        })()}
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
