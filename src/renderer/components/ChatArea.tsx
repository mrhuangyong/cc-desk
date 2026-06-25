import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, Copy, Check, Sparkles, Pencil } from 'lucide-react'
import { useStore } from '../state/store'
import { useI18n } from '../i18n/useI18n'
import { AttachmentChip } from './AttachmentChip'
import { BackendTaskPanel } from './BackendTaskPanel'
import { PlanCard } from './PlanCard'
import { InputBar } from './InputBar'
import { InputDock } from './InputDock'
import { PromptEditor } from '../editor/PromptEditor'
import { serializeForPrompt } from '../editor/serialize'
import { renderBlocks } from './blocks/BlockRenderer'
import { Notices } from './Notices'
import { Tooltip } from './Tooltip'

import type { ContentBlock, DraftAttachment, Message, TaskStatus } from '../types'

// SDK 的 TaskUpdate patch.status（原始字符串）→ 渲染端 TaskStatus 映射。
// TaskCreate 建任务时落 pending；SDK 用 in_progress 表示开始执行，映射成 running。
function mapTaskStatus(s?: string): TaskStatus {
  switch (s) {
    case 'in_progress': return 'running'
    case 'pending': return 'pending'
    case 'completed': return 'completed'
    case 'failed': return 'failed'
    case 'killed': return 'killed'
    case 'paused': return 'paused'
    default: return 'running'   // 未知按运行中处理（与旧行为一致，兜底）
  }
}

// 从消息 content blocks 提取可复制的纯文本（text + thinking + 工具摘要）
export function extractText(blocks: ContentBlock[]): string {
  return blocks.map(b => {
    if (b.type === 'text') return b.text
    if (b.type === 'thinking') return `(思考) ${b.text}`
    if (b.type === 'tool_use') {
      const r = b.result?.content ? `\n结果：${b.result.content}` : ''
      return `🔧 ${b.name}(${JSON.stringify(b.input)})${r}`
    }
    return ''
  }).join('\n').trim()
}

function messageAttachments(message: Message): DraftAttachment[] {
  if (message.attachments?.length) return message.attachments
  if (message.attachment) return [{ type: 'pickedElement', el: message.attachment }]
  return []
}

export function CopyButton({ text, inline }: { text: string; inline?: boolean }) {
  const [copied, setCopied] = useState(false)
  const onCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <Tooltip label="复制"><button className={inline ? 'msg-copy msg-copy-inline' : 'msg-copy'} onClick={onCopy} aria-label="复制">
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button></Tooltip>
  )
}

export function ChatArea() {
  const { state, dispatch } = useStore()
  const { t } = useI18n()

  // 找当前会话及其所属项目：单次遍历拿到两者（避免 flatMap 分配中间数组，
  // 也让 handleEditResend 能复用 project，无需二次 find）。
  const active = state.projects.find(p => p.sessions.some(s => s.id === state.activeSessionId))
  const session = active?.sessions.find(s => s.id === state.activeSessionId)

  // 当前会话的流式状态（增量拼接的 blocks/notices）
  const streaming = state.streamingBySession[state.activeSessionId]
  const isStreaming = !!streaming

  // 子代理渲染所需的派生数据，每轮渲染算一次（而非每条消息行 ×3 次）：
  //   - subagentToolUseIds：当前会话所有 subagent 任务的 toolUseId 集合，供 renderBlocks
  //     判断某 tool_use 是否归属某 subagent（决定渲染为子代理卡片还是普通工具卡）。
  //   - subagentOutputByToolUseId：当前会话子代理的累积输出。
  // ChatArea 在每个 STREAM_DELTA 重渲染，若内联到 renderBlocks 调用点，N 条消息会构造 N×3 个 Set。
  const sid = state.activeSessionId
  const subagentOutputByToolUseId = useMemo(
    () => state.subagentOutputBySession?.[sid] ?? {},
    [state.subagentOutputBySession, sid]
  )
  const subagentToolUseIds = useMemo(
    () => new Set((state.backendTasksBySession?.[sid] ?? []).filter(t => t.kind === 'subagent' && t.toolUseId).map(t => t.toolUseId!)),
    [state.backendTasksBySession, sid]
  )

  // 最后一条用户消息（编辑重发仅作用于它）
  const lastUserMessage = (() => {
    if (!session) return null
    for (let i = session.messages.length - 1; i >= 0; i--) {
      if (session.messages[i].role === 'user') return session.messages[i]
    }
    return null
  })()

  // 就地编辑态
  const [editDoc, setEditDoc] = useState<any>(null)

  // 编辑重发：截断历史 + 用新文本发送
  const handleEditResend = () => {
    if (!lastUserMessage) return
    const newPrompt = editDoc ? serializeForPrompt(editDoc).trim() : ''
    if (!newPrompt) return
    dispatch({ type: 'EDIT_RESEND', sessionId: state.activeSessionId, messageId: lastUserMessage.id, newPrompt })
    setEditDoc(null)
    // 截断后用新文本发送
    const claudeSessionId = state.claudeSessionMap?.[state.activeSessionId]
    const cwd = active?.path || state.settings?.cwd || undefined
    dispatch({ type: 'STREAM_START', sessionId: state.activeSessionId })
    window.api?.claude?.send({
      prompt: newPrompt,
      localSessionId: state.activeSessionId,
      sessionId: claudeSessionId || undefined,
      cwd,
    })
  }

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
  // settings 用 ref 在挂载一次的监听器闭包里取最新值（taskNotify/notifySound）。
  // 注意：流式回调用「事件自带的 localSessionId」路由，不再用「当前激活会话」，
  // 否则 A 发送后切到 B 会串台。activeSessionId 不再进 ref。
  const settingsRef = useRef(state.settings)
  useEffect(() => { settingsRef.current = state.settings }, [state.settings])
  // 桌面通知防抖：同一 body 文本 10 秒内只通知一次，避免重复轰炸
  const lastNotifRef = useRef<{ text: string; ts: number } | null>(null)
  const tasksRef = useRef(state.tasksBySession)
  useEffect(() => { tasksRef.current = state.tasksBySession }, [state.tasksBySession])

  // 注册 IPC 监听器：归一化后的新通道（delta/blocks/notice/result/error/aborted）
  useEffect(() => {
    const api = window.api?.claude
    if (!api) return

    // 桌面通知统一出口：10s 内同一 body 文本去重 + 构造 Notification + 点击聚焦窗口。
    // 三种通知场景（任务完成/出错、权限请求、需人工确认）共用，避免三处复制去重+构造逻辑。
    // 调用方各自先判断自己的开关（taskNotify/notifyOnPermission/notifyOnConfirm）。
    const dedupNotify = (title: string, body: string) => {
      if (!('Notification' in window)) return
      const s = settingsRef.current
      const now = Date.now()
      if (lastNotifRef.current && lastNotifRef.current.text === body && now - lastNotifRef.current.ts < 10000) return
      lastNotifRef.current = { text: body, ts: now }
      const n = new Notification(title, { body, silent: !s.notifySound })
      n.onclick = () => window.focus()
    }

    // 捕获 Claude 返回的真实 sessionId，建立 localSessionId → claudeSessionId 映射，供后续消息 resume 续接
    api.onSystem((data: any) => {
      if (data?.sessionId && data?.localSessionId) {
        dispatch({
          type: 'SET_CLAUDE_SESSION_ID',
          localSessionId: data.localSessionId,
          claudeSessionId: data.sessionId,
        })
      }
    })
    // 增量文本/思考。用事件自带的 localSessionId 路由（发送时绑定），而非「当前激活会话」，
    // 否则 A 发送后切到 B，A 的流式会串到 B。
    api.onDelta((data: any) => {
      const sid = data?.localSessionId
      if (!sid) {
        console.warn('[cc-stream] onDelta drop: no localSessionId')
        return
      }
      dispatch({ type: 'STREAM_DELTA', sessionId: sid, kind: data.kind, delta: data.delta })
    })
    // 归一化 blocks：工具开始 / assistant 整块 / 工具结果
    api.onBlocks((data: any) => {
      const sid = data?.localSessionId
      if (!sid) return
      if (data.op === 'tool_use_start') {
        dispatch({ type: 'STREAM_TOOL_USE_START', sessionId: sid, block: data.block })
      } else if (data.op === 'assistant_blocks') {
        dispatch({ type: 'STREAM_ASSISTANT_BLOCKS', sessionId: sid, blocks: data.blocks, uuid: data.uuid })
      } else if (data.op === 'tool_result') {
        dispatch({ type: 'STREAM_TOOL_RESULT', sessionId: sid, toolUseId: data.toolUseId, result: data.result, planFilePath: data.planFilePath })
      }
    })
    // 系统通知（状态/权限/压缩/重试/任务/错误等）。localSessionId 随载荷带来，剥离后作为 notice。
    api.onNotice((data: any) => {
      const sid = data?.localSessionId
      if (!sid) return
      const { localSessionId, ...notice } = data
      dispatch({ type: 'STREAM_NOTICE', sessionId: sid, notice })
    })
    api.onTask((data: any) => {
      const sid = data?.localSessionId
      if (!sid) return
      if (data.kind === 'todo_sync') {
        // TodoWrite 全量同步：把 input.todos 映射成 TaskItem，整体替换任务列表
        const todos = Array.isArray(data.todos) ? data.todos : []
        const tasks: import('../types').TaskItem[] = todos.map((td: any, idx: number) => ({
          id: td.id ?? `todo-${idx}`,
          description: td.content ?? td.activeForm ?? '',
          taskType: 'todo',
          status: td.status === 'completed' ? 'completed'
            : td.status === 'in_progress' ? 'running'
            : td.status === 'failed' ? 'failed'
            : 'pending',
          details: td.content ?? '',
          activeForm: td.activeForm ?? '',
          createdAt: Date.now(),
        }))
        dispatch({ type: 'SET_TASKS', sessionId: sid, tasks })
      } else if (data.kind === 'started') {
        // TaskCreate 工具返回「Task #N created」即建任务：此刻任务刚登记、尚未真正执行，
        // 落 pending（待处理）；后续 SDK TaskUpdate{status:'in_progress'} 经 updated 分支转 running。
        dispatch({ type: 'UPSERT_TASK', sessionId: sid, task: {
          id: data.taskId, description: data.description ?? '', taskType: data.taskType ?? '', status: 'pending',
          subject: data.subject, details: data.details, activeForm: data.activeForm, createdAt: data.createdAt,
        } })
      } else if (data.kind === 'updated') {
        // 合并 patch：需读当前 task 再更新状态字段；status 经 mapTaskStatus 归一化
        const list = tasksRef.current[sid] ?? []
        const existing = list.find(t => t.id === data.taskId)
        if (existing) {
          const patch = { ...data.patch }
          if (typeof patch.status === 'string') patch.status = mapTaskStatus(patch.status)
          dispatch({ type: 'UPSERT_TASK', sessionId: sid, task: { ...existing, ...patch } })
        }
      }
    })
    const unsubBackendTask = window.api.backendTask.onEvent((data: any) => {
      if (!data || !data.task) return
      if (data.op === 'create' || data.op === 'update') {
        dispatch({ type: 'UPSERT_BACKEND_TASK', sessionId: data.localSessionId, task: data.task })
      }
    })
    // subagent 自己的对话输出：按 toolUseId 累积进 subagentOutputBySession，
    // 供 Task 工具卡片下方的折叠区展示（不进主消息流）。
    api.onSubagentOutput((data: any) => {
      const sid = data?.localSessionId
      if (!sid) return
      const blocks = Array.isArray(data.block) ? data.block : []
      for (const b of blocks) {
        dispatch({ type: 'APPEND_SUBAGENT_OUTPUT', sessionId: sid, toolUseId: data.toolUseId, block: b })
      }
    })
    api.onResult((data: any) => {
      const sid = data?.localSessionId
      if (!sid) return
      dispatch({
        type: 'STREAM_END',
        sessionId: sid,
        costUSD: data.costUSD,
        durationMs: data.durationMs,
        turns: data.turns,
        isError: data.isError,
      })
      // 任务通知：按场景分流（主开关短路 + 子开关控制 + 10s 防抖去重走 dedupNotify）
      const s = settingsRef.current
      const fireNotify = (title: string, body: string) => {
        if (!s.taskNotify) return
        dedupNotify(title, body)
      }
      if (data.isError) {
        if (s.notifyOnError) fireNotify(t('chat.taskError'), t('chat.taskErrorBody'))
      } else {
        if (s.notifyOnComplete) fireNotify(t('chat.taskDone'), t('chat.taskDoneBody'))
      }
    })
    api.onError((data: any) => {
      const sid = data?.localSessionId
      if (!sid) return
      dispatch({ type: 'STREAM_ERROR', sessionId: sid, error: data.error })
    })
    api.onAborted((data: any) => {
      const sid = data?.localSessionId
      if (!sid) return
      dispatch({ type: 'STREAM_ABORTED', sessionId: sid })
      // 用户主动停止：把该会话所有未结束的 TaskCreate 任务（pending/running）置为 killed。
      // 主进程 interrupt() 只终止 registry 里的 subagent/shell 等后台任务（走 claude:backend-task），
      // 不持有 tasksBySession，无法终止 TaskItem——这里在渲染端补齐，让任务行立即停转。
      dispatch({ type: 'KILL_RUNNING_TASKS', sessionId: sid })
    })
    // AskUserQuestion 等用户对话请求
    api.onDialogRequest((data) => {
      dispatch({ type: 'SHOW_DIALOG', reqId: data.reqId, sessionId: data.localSessionId, dialogKind: data.dialogKind, payload: data.payload, toolUseId: data.toolUseId })
      // 权限请求通知：工具需要用户确认权限时发桌面通知
      const s = settingsRef.current
      if (s.notifyOnPermission && s.taskNotify) {
        const body = (data?.payload?.toolName || data?.payload?.tool_name) || t('chat.permissionRequest')
        dedupNotify(t('chat.permissionRequest'), body)
      }
    })

    // SDK notification 事件（如 Claude 需要人类介入/确认）：原生拦截后发桌面通知
    api.onNotification((data: any) => {
      const s = settingsRef.current
      if (!s.notifyOnConfirm || !s.taskNotify) return
      const body = data?.text || t('chat.needsAttention')
      dedupNotify(t('chat.needsAttention'), body)
    })

    return () => {
      unsubBackendTask()
      api.removeAllListeners()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])


  if (!session) {
    return <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--text-muted)' }}>{t('chat.noSession')}</div>
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--bg)', position: 'relative' }}>
      <BackendTaskPanel
        tasks={state.tasksBySession[state.activeSessionId] ?? []}
        backendTasks={state.backendTasksBySession[state.activeSessionId] ?? []}
        showTodo={state.settings.showTodo}
        showBackendTask={state.settings.showBackendTask}
        activeSessionId={state.activeSessionId}
        subagentOutputByToolUseId={state.subagentOutputBySession[state.activeSessionId] ?? {}}
      />
      <PlanCard
        sessionId={state.activeSessionId}
        pendingPlan={state.pendingDialog?.dialogKind === 'plan_proposed' && state.pendingDialog.sessionId === state.activeSessionId
          ? { reqId: state.pendingDialog.reqId, plan: state.pendingDialog.payload?.plan ?? '', allowedPrompts: state.pendingDialog.payload?.allowedPrompts }
          : null}
        dispatch={dispatch}
      />
      <div
        ref={scrollRef}
        onScroll={onScroll}
        style={{ flex: 1, overflowY: 'auto', padding: '20px 28px 48px', display: 'flex', flexDirection: 'column', gap: 28, width: '100%', maxWidth: 'var(--chat-max-width)', margin: '0 auto' }}
      >
        {session.messages.length === 0 && !streaming && (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: 60 }}>{t('chat.empty')}</div>
        )}
        {session.messages.map(m => {
          // streaming 进行中时,跳过 draft message(它由下方 streaming 区渲染,避免重复显示)
          if (streaming?.draftMessageId === m.id) return null
          return (
            m.role === 'assistant' ? (
            // AI 消息：全宽左对齐，无背景；block 之间用 hairline 分隔
            <div key={m.id} className="msg-row is-assistant" style={{
              alignSelf: 'flex-start', width: '100%',
              color: 'var(--text)',
              display: 'flex', flexDirection: 'column', gap: 0,
              userSelect: 'text', cursor: 'text',
            }}>
              {messageAttachments(m).map((attachment, index) => <AttachmentChip key={index} attachment={attachment} />)}
              <Notices notices={m.notices ?? []} />
              {renderBlocks(m.content, false, subagentOutputByToolUseId, subagentToolUseIds)}
              {/* 底部行：cost 元数据 + 复制钮，mono 小字 */}
              <div className="msg-foot" style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                {(m.costUSD != null || m.durationMs != null) && (
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                    {m.costUSD != null && `$${m.costUSD.toFixed(4)} `}
                    {m.durationMs != null && `${(m.durationMs / 1000).toFixed(1)}s`}
                    {m.turns != null && ` · ${m.turns} 轮`}
                  </div>
                )}
                <CopyButton text={extractText(m.content)} inline />
              </div>
            </div>
          ) : (
            // 用户消息：右对齐，收紧气泡（maxWidth 限制 + 小 padding，避免占满整行）
            <div key={m.id} className="msg-row is-user" style={{
              alignSelf: 'flex-end', maxWidth: '75%',
              background: 'var(--surface-1)', borderRadius: 'var(--radius)', padding: '5px 11px',
              color: 'var(--text)',
              display: 'flex', flexDirection: 'column', gap: 2,
              userSelect: 'text', cursor: 'text',
              position: 'relative',
            }}>
              {/* 编辑重发按钮：仅最后一条用户消息 + 非流式 + 非编辑态时显示，紧贴复制钮左侧 */}
              {m.id === lastUserMessage?.id && !isStreaming && state.editingMessageId !== m.id && (
                <button
                  onClick={() => {
                    const origText = extractText(m.content)
                    setEditDoc({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: origText }] }] })
                    dispatch({ type: 'SET_EDITING_MESSAGE', messageId: m.id })
                  }}
                  title={t('chat.edit')}
                  className="msg-copy edit-resend-btn"
                >
                  <Pencil size={13} />
                </button>
              )}
              {state.editingMessageId === m.id && editDoc ? (
                /* 就地编辑态：PromptEditor + 取消/重发 */
                <div style={{ minWidth: 280 }}>
                  <PromptEditor
                    doc={editDoc}
                    placeholder=""
                    allSlashItems={[]}
                    getCwd={() => ''}
                    onDocChange={(doc) => setEditDoc(doc)}
                    onSend={handleEditResend}
                    onEditorReady={() => {}}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => { setEditDoc(null); dispatch({ type: 'SET_EDITING_MESSAGE', messageId: null }) }}
                      style={{ padding: '4px 12px', fontSize: 12, cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', color: 'var(--text-muted)' }}
                    >{t('chat.editCancel')}</button>
                    <button
                      onClick={handleEditResend}
                      disabled={!serializeForPrompt(editDoc).trim()}
                      style={{ padding: '4px 12px', fontSize: 12, cursor: serializeForPrompt(editDoc).trim() ? 'pointer' : 'not-allowed', border: 'none', borderRadius: 6, background: serializeForPrompt(editDoc).trim() ? 'var(--accent)' : 'var(--bg-hover)', color: serializeForPrompt(editDoc).trim() ? 'var(--accent-text)' : 'var(--text-faint)' }}
                    >{t('chat.editSend')}</button>
                  </div>
                </div>
              ) : (
                <>
                  {messageAttachments(m).map((attachment, index) => <AttachmentChip key={index} attachment={attachment} />)}
                  {renderBlocks(m.content, true, subagentOutputByToolUseId, subagentToolUseIds)}
                  <CopyButton text={extractText(m.content)} />
                </>
              )}
            </div>
          )
        )})}
        {/* 流式消息：notice + blocks + 错误 + 思考中指示器 */}
        {streaming && (
          <div style={{ color: 'var(--text)', fontSize: 14, lineHeight: 1.6, padding: '0 28px', display: 'flex', flexDirection: 'column', gap: 8, userSelect: 'text' }}>
            <Notices notices={streaming.notices ?? []} />
            {renderBlocks(streaming.blocks, false, subagentOutputByToolUseId, subagentToolUseIds)}
            {streaming.error && <div style={{ color: '#ef4444', fontSize: 13 }}>❌ {streaming.error}</div>}
            {/* 思考中指示器:Sparkles 图标 + 文字,呼吸式脉冲动画(参考 codex app) */}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', fontSize: 13 }}>
              <Sparkles size={14} className="cc-pulse" style={{ color: 'var(--accent)' }} />
              <span className="cc-pulse">思考中</span>
            </div>
          </div>
        )}
      </div>
      <div style={{ padding: '0 28px 20px', width: '100%', maxWidth: 'var(--chat-max-width)', margin: '0 auto', position: 'relative' }}>
        {/* 回到底部按钮：相对输入框容器定位，底边恒在输入框上边框上方 20px */}
        {showScrollBtn && (
          <Tooltip label="回到底部" placement="top">
          <button
            onClick={() => scrollToBottom('smooth')}
            aria-label="回到底部"
            style={{
              position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: '100%', marginBottom: 20,
              width: 34, height: 34, borderRadius: '50%',
              background: 'var(--surface-1)',
              boxShadow: 'var(--shadow-float)', color: 'var(--text)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', zIndex: 50,
            }}
          >
            <ArrowDown size={16} />
          </button>
          </Tooltip>
        )}
        <InputDock />
      </div>
    </div>
  )
}
