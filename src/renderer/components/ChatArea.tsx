import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Virtuoso, type VirtuosoHandle, type ItemProps } from 'react-virtuoso'
import { ArrowDown, Copy, Check, Sparkles } from 'lucide-react'
import { useSelector, useDispatch } from '../state/store'
import type { AppState } from '../state/reducer'
import { useI18n } from '../i18n/useI18n'
import { useStreamBatcher } from '../hooks/useStreamBatcher'
import { BackendTaskPanel } from './BackendTaskPanel'
import { PlanCard } from './PlanCard'
import { GoalIndicator } from './GoalIndicator'
import { GoalCard } from './GoalCard'
import { InputBar } from './InputBar'
import { InputDock } from './InputDock'
import { AnswerPanel } from './AnswerPanel'
import { PermissionPanel } from './PermissionPanel'
import { serializeForPrompt } from '../editor/serialize'
import { Notices } from './Notices'
import { Tooltip } from './Tooltip'
import { MessageRow } from './MessageRow'

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

export function messageAttachments(message: Message): DraftAttachment[] {
  if (message.attachments?.length) return message.attachments
  if (message.attachment) return [{ type: 'pickedElement', el: message.attachment }]
  return []
}

// react-virtuoso 的 Item(每条消息的外层 wrapper):默认是 block,会把子元素 stretch 到全宽,
// 导致 MessageRow 的 alignSelf:flex-end(user 右对齐)失效。改成 display:flex,让 MessageRow
// 的 alignSelf 相对 Item 生效:user 消息 flex-end 右对齐,assistant 消息默认 flex-start 左对齐。
// minWidth:0 必加——flex 子项默认 min-width:auto 不收缩,长内容(代码块/长行)会撑宽 Item
// 致整个列表水平滚动、内容不换行。props 用 react-virtuoso 的 ItemProps(带 data-index 等)。
const VirtuosoItem = forwardRef<HTMLDivElement, ItemProps<Message>>(
  function VirtuosoItem({ children, style, ...rest }, ref) {
    return (
      <div ref={ref} {...rest} style={{ ...style, display: 'flex', minWidth: 0 }}>
        {children}
      </div>
    )
  },
)

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
  // 分片订阅（Layer 2）：流式高频变化字段单独订阅，reducer 不改该切片时引用稳定 → 不重渲。
  const dispatch = useDispatch()
  const activeSessionId = useSelector((s: AppState) => s.activeSessionId)
  const projects = useSelector((s: AppState) => s.projects)
  const streamingBySession = useSelector((s: AppState) => s.streamingBySession)
  const subagentOutputBySession = useSelector((s: AppState) => s.subagentOutputBySession)
  const backendTasksBySession = useSelector((s: AppState) => s.backendTasksBySession)
  const tasksBySession = useSelector((s: AppState) => s.tasksBySession)
  const settings = useSelector((s: AppState) => s.settings)
  const pendingDialog = useSelector((s: AppState) => s.pendingDialog)
  const editingMessageId = useSelector((s: AppState) => s.editingMessageId)
  const claudeSessionMap = useSelector((s: AppState) => s.claudeSessionMap)
  // /goal 状态卡片开关:GoalIndicator 点击 SHOW_GOAL_STATUS 置位,GoalCard 关闭 HIDE_GOAL_CARD 清空。
  const goalCardOpen = useSelector((s: AppState) => s.goalCardOpen)
  const { t } = useI18n()
  // 流式 delta 走 rAF 节流批处理：把高频 STREAM_DELTA 合并到每帧一次派发，
  // 降低 reducer/重渲染开销；在中断/结束事件到达时由调用方 flush() 兜底。
  const { pushDelta, flush } = useStreamBatcher(dispatch)

  // 找当前会话及其所属项目：单次遍历拿到两者（避免 flatMap 分配中间数组，
  // 也让 handleEditResend 能复用 project，无需二次 find）。
  const active = projects.find(p => p.sessions.some(s => s.id === activeSessionId))
  const session = active?.sessions.find(s => s.id === activeSessionId)

  // 当前会话的流式状态（增量拼接的 blocks/notices）
  const streaming = streamingBySession[activeSessionId]
  const isStreaming = !!streaming

  // 子代理渲染所需的派生数据，每轮渲染算一次（而非每条消息行 ×3 次）：
  //   - subagentToolUseIds：当前会话所有 subagent 任务的 toolUseId 集合，供 renderBlocks
  //     判断某 tool_use 是否归属某 subagent（决定渲染为子代理卡片还是普通工具卡）。
  //   - subagentOutputByToolUseId：当前会话子代理的累积输出。
  // ChatArea 在每个 STREAM_DELTA 重渲染，若内联到 renderBlocks 调用点，N 条消息会构造 N×3 个 Set。
  const sid = activeSessionId
  const subagentOutputByToolUseId = useMemo(
    () => subagentOutputBySession?.[sid] ?? {},
    [subagentOutputBySession, sid]
  )
  const subagentToolUseIds = useMemo(
    () => new Set((backendTasksBySession?.[sid] ?? []).filter(t => t.kind === 'subagent' && t.toolUseId).map(t => t.toolUseId!)),
    [backendTasksBySession, sid]
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
  const handleEditResend = useCallback(() => {
    if (!lastUserMessage) return
    const newPrompt = editDoc ? serializeForPrompt(editDoc).trim() : ''
    if (!newPrompt) return
    dispatch({ type: 'EDIT_RESEND', sessionId: activeSessionId, messageId: lastUserMessage.id, newPrompt })
    setEditDoc(null)
    // 截断后用新文本发送
    const claudeSessionId = claudeSessionMap?.[activeSessionId]
    const cwd = active?.path || settings?.cwd || undefined
    dispatch({ type: 'STREAM_START', sessionId: activeSessionId })
    window.api?.claude?.send({
      prompt: newPrompt,
      localSessionId: activeSessionId,
      sessionId: claudeSessionId || undefined,
      cwd,
    })
  }, [lastUserMessage, activeSessionId, claudeSessionMap, active, settings?.cwd, editDoc])

  // ===== 滚动「贴底」逻辑（迁移到 react-virtuoso 原语）=====
  // 原则：AI 输出时若用户在底部则自动滚动跟随；用户主动上滑后停止自动滚动，
  //       直到用户再次滚到底部才恢复。isAtBottomRef 由 Virtuoso 的 atBottomStateChange 回调维护，
  //       避免滚轮触发频繁重渲染；showScrollBtn 仅用于控制「回到底部」按钮显隐。
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const isAtBottomRef = useRef(true)
  const [showScrollBtn, setShowScrollBtn] = useState(false)

  const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
    // Virtuoso 滚到底：smooth 时用 animate，auto 时立即
    virtuosoRef.current?.scrollToIndex({
      index: 'LAST',
      behavior: behavior === 'smooth' ? 'smooth' : 'auto',
      align: 'end',
    })
    isAtBottomRef.current = true
    setShowScrollBtn(false)
  }

  // 新消息追加（messages.length 变化）时，若用户在底部则贴底。
  // 流式过程中草稿 message 内容逐帧增长由 Virtuoso followOutput 自动跟随，
  // 不需要手动 scrollToBottom——那样每帧 60fps 触发会与 Virtuoso 自身的 smooth follow 冲突，
  // 导致对话内容视觉跳动。这里仅在长度变化（新 message 加入）时做一次 snap。
  useEffect(() => {
    if (isAtBottomRef.current) scrollToBottom('auto')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.messages.length])

  // 切换会话：立即贴底（重置 isAtBottom）
  useEffect(() => {
    isAtBottomRef.current = true
    setShowScrollBtn(false)
    scrollToBottom('auto')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId])

  // AskUserQuestion / 权限授权 / 计划卡片弹出时自动滚到底：面板作为对话区内联块会把
  // 消息往上推，滚到底让「触发该提问的最近消息」与面板一同可见。
  useEffect(() => {
    const dlg = pendingDialog
    if (dlg && dlg.sessionId === activeSessionId &&
        (dlg.dialogKind === 'ask_user_question' || dlg.dialogKind === 'permission_request' || dlg.dialogKind === 'plan_proposed')) {
      // 延迟一帧，等面板渲染撑高布局后再滚，确保滚到真实底部
      requestAnimationFrame(() => scrollToBottom('smooth'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDialog, activeSessionId])

  // 监听器只在挂载时注册一次，回调内需要的"会变值"通过 ref 取最新值，
  // settings 用 ref 在挂载一次的监听器闭包里取最新值（taskNotify/notifySound）。
  // 注意：流式回调用「事件自带的 localSessionId」路由，不再用「当前激活会话」，
  // 否则 A 发送后切到 B 会串台。activeSessionId 不再进 ref。
  const settingsRef = useRef(settings)
  useEffect(() => { settingsRef.current = settings }, [settings])
  // 桌面通知防抖：同一 body 文本 10 秒内只通知一次，避免重复轰炸
  const lastNotifRef = useRef<{ text: string; ts: number } | null>(null)
  const tasksRef = useRef(tasksBySession)
  useEffect(() => { tasksRef.current = tasksBySession }, [tasksBySession])

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
      pushDelta(sid, data.kind, data.delta)
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
      flush()  // 兜底：确保末尾 delta 已派发再固化结束
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
      flush()  // 兜底：错误前确保末尾 delta 已派发
      dispatch({ type: 'STREAM_ERROR', sessionId: sid, error: data.error })
    })
    api.onAborted((data: any) => {
      const sid = data?.localSessionId
      if (!sid) return
      flush()  // 兜底：用户点「停止」时把缓冲的末尾 delta 冲出，避免丢失
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

    // dialog 已被任一端解决（手机/桌面回答）：清桌面端残留面板，避免双端可弹时面板挂着。
    api.onDialogResolved?.((data) => {
      dispatch({ type: 'DIALOG_RESOLVED', reqId: data.reqId })
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
        tasks={tasksBySession[activeSessionId] ?? []}
        backendTasks={backendTasksBySession[activeSessionId] ?? []}
        showTodo={settings.showTodo}
        showBackendTask={settings.showBackendTask}
        activeSessionId={activeSessionId}
        subagentOutputByToolUseId={subagentOutputBySession[activeSessionId] ?? {}}
      />
      {/* /goal 激活时常驻指示条(条件简述+轮数+时长),点击展开 GoalCard */}
      <GoalIndicator onOpen={() => dispatch({ type: 'SHOW_GOAL_STATUS', sessionId: activeSessionId })} />
      {goalCardOpen === activeSessionId && (
        <div style={{ padding: '0 28px 12px' }}>
          <GoalCard onClose={() => dispatch({ type: 'HIDE_GOAL_CARD' })} />
        </div>
      )}
      {/* 空会话提示：放在 Virtuoso 外层条件渲染（空列表时 Virtuoso 高度为 0） */}
      {session.messages.length === 0 && !streaming && (
        <div style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: 60, flex: 1 }}>{t('chat.empty')}</div>
      )}
      {/* react-virtuoso 虚拟化消息列表：仅挂载可见区消息，草稿走方案 A（不再跳过 draftMessageId，
          它已在 session.messages 中，由 reducer 的 syncDraftMessage 同步 content）。
          布局契约(经源码+官方示例确认):Virtuoso 必须占满父容器宽度来计算虚拟化尺寸,
          故 maxWidth 居中 + padding 由【外层 wrapper div】承担,绝不放进 Virtuoso 或其 components
          (前几轮反复在 Scroller/List/Item 上塞 maxWidth/padding,破坏宽度计算致布局崩溃)。
          Virtuoso 自身 style 只设 height:100%(官方推荐),占满 wrapper。 */}
      <div style={{ flex: 1, width: '100%', maxWidth: 'var(--chat-max-width)', margin: '0 auto', padding: '20px 28px 48px', minHeight: 0 }}>
        <Virtuoso
          ref={virtuosoRef}
          data={session.messages}
          followOutput={(atBottom) => (atBottom ? 'smooth' : false)}
          atBottomStateChange={(atBottom) => {
            isAtBottomRef.current = atBottom
            setShowScrollBtn(!atBottom)
          }}
          className="chat-scroll"
          style={{ height: '100%' }}
          components={{
            // 每条消息的外层 wrapper:display:flex,让 MessageRow 的 alignSelf:flex-end(user 右对齐)生效。
            // 默认 Item 是 block(stretch 全宽),会让 alignSelf 失效。
            Item: VirtuosoItem,
            // 流式附加区（列表底部，随列表滚动）：仅 notices + error + 思考中指示器
            // （blocks 已在草稿 message 里）。非流式时返回 null，不占位。
            Footer: () => streaming ? (
              <div style={{ color: 'var(--text)', fontSize: 14, lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: 8, userSelect: 'text' }}>
                <Notices notices={streaming.notices ?? []} />
                {streaming.error && <div style={{ color: '#ef4444', fontSize: 13 }}>❌ {streaming.error}</div>}
                {/* 思考中指示器:Sparkles 图标 + 文字,呼吸式脉冲动画(参考 codex app) */}
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', fontSize: 13 }}>
                  <Sparkles size={14} className="cc-pulse" style={{ color: 'var(--accent)' }} />
                  <span className="cc-pulse">思考中</span>
                </div>
              </div>
            ) : null,
          }}
        itemContent={(index, m) => {
          // 方案 A：草稿消息正常渲染（不再跳过 draftMessageId）。草稿 content 由 reducer 同步，
          // 流式追加时它的 MessageRow 自然重渲染。notices/error/思考指示器不在草稿 message 上，
          // 通过 components.Footer 补显。
          return (
            <MessageRow
              key={m.id}
              message={m}
              isStreaming={isStreaming}
              subagentOutputByToolUseId={subagentOutputByToolUseId}
              subagentToolUseIds={subagentToolUseIds}
              isLastUserMessage={m.id === lastUserMessage?.id}
              editingMessageId={editingMessageId}
              editDoc={editDoc}
              onEditDocChange={setEditDoc}
              onEditResend={handleEditResend}
              showThinking={settings.showThinking}
            />
          )
        }}
      />
      </div>
      {/* AskUserQuestion / 权限授权 / 计划卡片：作为对话区内联块（非浮层），占据对话区空间把
          消息往上推，永不遮挡对话内容。限宽居中，与消息气泡对齐。三种 dialogKind 共用此包裹。
          放在 Virtuoso 之外（非虚拟化项），避免被回收。 */}
      {pendingDialog && pendingDialog.sessionId === activeSessionId && (
        <div style={{ width: '100%', maxWidth: 'var(--chat-max-width)', margin: '0 auto', padding: '0 28px' }}>
          {pendingDialog.dialogKind === 'permission_request' ? <PermissionPanel />
            : pendingDialog.dialogKind === 'plan_proposed'
              ? <PlanCard
                  sessionId={activeSessionId}
                  pendingPlan={{ reqId: pendingDialog.reqId, plan: pendingDialog.payload?.plan ?? '', allowedPrompts: pendingDialog.payload?.allowedPrompts }}
                  dispatch={dispatch}
                />
              : <AnswerPanel />}
        </div>
      )}
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
