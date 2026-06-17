import { useEffect, useRef, useState } from 'react'
import { ArrowDown } from 'lucide-react'
import { useStore } from '../state/store'
import { useI18n } from '../i18n/useI18n'
import { AttachmentChip } from './AttachmentChip'
import { InputBar } from './InputBar'
import { InputDock } from './InputDock'
import { BlockRenderer } from './blocks/BlockRenderer'
import { Notices } from './Notices'

export function ChatArea() {
  const { state, dispatch } = useStore()
  const { t } = useI18n()

  // 找当前会话
  const session = state.projects
    .flatMap(p => p.sessions)
    .find(s => s.id === state.activeSessionId)

  // 当前会话的流式状态（增量拼接的 blocks/notices）
  const streaming = state.streamingBySession[state.activeSessionId]

  // ===== 滚动「贴底」逻辑 =====
  // 原则：AI 输出时若用户在底部则自动滚动跟随；用户主动上滑后停止自动滚动，
  //       直到用户再次滚到底部才恢复。isAtBottomRef 用 ref 在 scroll 回调里取最新值，
  //       避免滚轮触发频繁重渲染；isAtBottom state 仅用于控制「回到底部」按钮显隐。
  const scrollRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const BOTTOM_THRESHOLD = 40 // 距底部多少像素内视为「在底部」

  const checkAtBottom = () => {
    const el = scrollRef.current
    if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD
  }
  const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
    isAtBottomRef.current = true
    setShowScrollBtn(false)
  }
  const onScroll = () => {
    const at = checkAtBottom()
    isAtBottomRef.current = at
    setShowScrollBtn(!at)
  }

  // 流式内容/消息变化时，若用户在底部则跟随滚动
  useEffect(() => {
    if (isAtBottomRef.current) scrollToBottom('auto')
  }, [streaming, session?.messages.length])

  // 切换会话：立即贴底（重置 isAtBottom）
  useEffect(() => {
    isAtBottomRef.current = true
    setShowScrollBtn(false)
    scrollToBottom('auto')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.activeSessionId])

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
    // AskUserQuestion 等用户对话请求
    api.onDialogRequest((data) => {
      dispatch({ type: 'SHOW_DIALOG', reqId: data.reqId, dialogKind: data.dialogKind, payload: data.payload, toolUseId: data.toolUseId })
    })

    return () => api.removeAllListeners()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])


  if (!session) {
    return <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--text-muted)' }}>{t('chat.noSession')}</div>
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--bg)', position: 'relative' }}>
      {/* 闪烁光标动画 */}
      <style>{`@keyframes blink { 50% { opacity: 0 } }`}</style>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        style={{ flex: 1, overflowY: 'auto', padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 14, width: '100%', maxWidth: 'var(--chat-max-width)', margin: '0 auto' }}
      >
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
              <Notices notices={m.notices ?? []} />
              {m.content.map((b, i) => <BlockRenderer key={i} block={b} />)}
              {(m.costUSD != null || m.durationMs != null) && (
                <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                  {m.costUSD != null && `$${m.costUSD.toFixed(4)} `}
                  {m.durationMs != null && `${(m.durationMs / 1000).toFixed(1)}s`}
                  {m.turns != null && ` · ${m.turns} 轮`}
                </div>
              )}
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
              {m.content.map((b, i) => <BlockRenderer key={i} block={b} />)}
            </div>
          )
        ))}
        {/* 流式消息：notice + blocks + 错误 + 闪烁光标 */}
        {streaming && (
          <div style={{ color: 'var(--text)', fontSize: 14, lineHeight: 1.6, padding: '0 28px', display: 'flex', flexDirection: 'column', gap: 8, userSelect: 'text' }}>
            <Notices notices={streaming.notices ?? []} />
            {streaming.blocks.map((b, i) => <BlockRenderer key={i} block={b} />)}
            {streaming.error && <div style={{ color: '#ef4444', fontSize: 13 }}>❌ {streaming.error}</div>}
            <span style={{ animation: 'blink 1s step-end infinite' }}>▌</span>
          </div>
        )}
      </div>
      {/* 回到底部按钮：仅当不在底部时显示，相对最外层 relative 定位在右下 */}
      {showScrollBtn && (
        <button
          onClick={() => scrollToBottom('smooth')}
          aria-label="回到底部"
          title="回到底部"
          style={{
            position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 92,
            width: 34, height: 34, borderRadius: '50%',
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            boxShadow: 'var(--shadow-float)', color: 'var(--text)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', zIndex: 50,
          }}
        >
          <ArrowDown size={16} />
        </button>
      )}
      <div style={{ padding: '0 28px 20px', width: '100%', maxWidth: 'var(--chat-max-width)', margin: '0 auto' }}>
        <InputDock />
      </div>
    </div>
  )
}
