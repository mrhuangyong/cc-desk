// web/src/hooks/useSessionChat.ts
// 单会话的对话状态机（Task 14）：流式文本/思考拼接、blocks 累加、消息收尾、
// 用户输入发送与本地 echo、中断。
//
// 纯逻辑（拼接、块分类）下沉到 lib/chat-blocks.ts，本 hook 做 React 状态同步 +
// 传输桥接（send）+ 消息轮次生命周期。
//
// 协议契约（src/main/remote-bridge.ts forwarder）：
//   session.delta.payload = { localSessionId, text? | thinking? }
//   session.blocks.payload = { localSessionId, blocks: [...] }（透传 claude:blocks）
//   session.result.payload = { localSessionId, ... }（一轮结束）
//   发 session.message = { localSessionId, text }（remote-bridge dispatcher 对齐）
//   发 session.interrupt = { localSessionId }
//
// 消息轮次：一次 user 输入 → 进入 running，后续 delta/blocks 累加到「当前 assistant 消息」；
//   收到 session.result → running=false，下一次 delta 开新一轮 assistant 消息。
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Envelope, MessageType } from '@shared/remote-protocol-types'
import {
  type ChatMessage,
  type ChatBlock,
  mkMessage,
  appendDelta,
  appendBlock,
  classifyBlock,
  mergeToolResult,
  mergeAssistantBlocks,
} from '../lib/chat-blocks'

/** 用户消息（与 ChatMessage 区分：role=user，无 blocks/thinking）。 */
export interface UserMessage {
  role: 'user'
  text: string
}

/** 系统提示/警告消息（来自 session.notice），插入对话流但不参与 assistant blocks。 */
export interface NoticeMessage {
  role: 'notice'
  text: string
  level?: 'info' | 'warn' | 'error'
  kind?: string
}

export type AnyMessage = ChatMessage | UserMessage | NoticeMessage

export interface SendMessageOptions {
  permission?: string
  thinking?: 'low' | 'medium' | 'high'
  extraDirs?: string[]
  images?: { mediaType: string; data: string; name?: string }[]
  queueMode?: 'queue' | 'guide'
}

export interface QueuedMessage {
  text: string
  opts: Omit<SendMessageOptions, 'queueMode'>
}

export type ChatSendFn = (
  type: Extract<MessageType, 'session.message' | 'session.interrupt' | 'session.history.request'>,
  payload: unknown,
) => Promise<boolean>

export interface UseSessionChatOptions {
  send: ChatSendFn
}

/** 桌面端下发的历史消息项（与 src/main/remote-bridge.ts HistoryItem 对齐）。 */
interface HistoryItem {
  role: 'user' | 'assistant'
  text?: string
  thinking?: string
  blocks?: { kind: 'tool_use' | 'tool_result' | 'plan'; label: string }[]
}

export interface UseSessionChatHandle {
  /** 消息序列（user 与 assistant 交替）。 */
  messages: AnyMessage[]
  /** 是否正在流式输出（一轮未收 result）。 */
  running: boolean
  /** 是否还有更早的历史可加载（分页上拉）。 */
  hasMoreHistory: boolean
  /** 历史灌入计数（每次 session.history 到达 +1）。UI 据此触发强制滚动。 */
  historyVersion: number
  /** 入站信封处理器：挂在 useRelay 的 onInbound。处理 session.delta/blocks/result/history。 */
  onInbound(env: Envelope): void
  /** 发送用户消息：本地 echo user 消息 + 发 session.message + 进入 running。
   *  模型切换走 session.setActiveModel（改桌面 activeModelId，sdkEnv+model 一起切换，保证一致）。
   *  opts 透传 permission/thinking/extraDirs/images（不传则向后兼容，只发 localSessionId/text）。 */
  sendMessage(
    localSessionId: string,
    text: string,
    opts?: SendMessageOptions,
  ): Promise<boolean>
  /** 中断当前 query。 */
  interrupt(localSessionId: string): Promise<void>
  /** 拉取历史对话（attach 后调；hasMore=true 时可继续上拉）。 */
  loadHistory(localSessionId: string, limit?: number): Promise<void>
  /** 清空消息（切会话/卸载）。 */
  reset(): void
  /** 当前编辑的 user 消息 index(null=非编辑态)。 */
  editingIndex: number | null
  /** 进入/退出编辑态(传 index 进入编辑该消息,传 null 退出)。 */
  setEditing: (index: number | null) => void
  /** 编辑重发:截断 index 及之后消息,用新文本替换该 user + 中断(若在跑)+ 重发。 */
  editAndResend(localSessionId: string, index: number, newText: string): Promise<void>
  /** 排队中的消息文本(queue 模式流式时发送的消息,AI 结束后自动发)。 */
  queue: QueuedMessage[]
  /** 子代理(Task 工具)输出:按父 Task 的 toolUseId 聚合其内部块,供 Task 卡片展开内嵌显示。 */
  subagentOutput: Record<string, ChatBlock[]>
}

/** 从 session.blocks payload 取出 blocks 数组（容错，归一化桌面端 claude:blocks 的三种 op）。
 *  桌面端 claude:blocks 按 op 分发,结构不一:
 *    - tool_use_start: { op, block: {type:'tool_use',...} }  单块(block 单数)
 *    - tool_result:    { op, toolUseId, result }             无 block/blocks,需归一化
 *    - assistant_blocks:{ op, blocks: [...] }                 含 blocks 数组(纯文本/工具)
 *  这里统一转成 blocks 数组,供 classifyBlock 进一步归一化为渲染块。 */
function extractBlocks(payload: any): unknown[] {
  if (!payload) return []
  if (Array.isArray(payload)) return payload
  // assistant_blocks:含 blocks 数组(文本/工具的权威整块)
  if (Array.isArray(payload.blocks)) return payload.blocks
  // tool_use_start:单块(block 单数)→ 包成数组
  if (payload.block && typeof payload.block === 'object') return [payload.block]
  // tool_result:归一化为 { type:'tool_result', tool_use_id, content, is_error }
  if (payload.op === 'tool_result' && payload.toolUseId) {
    return [{
      type: 'tool_result',
      tool_use_id: payload.toolUseId,
      content: payload.result?.content ?? '',
      is_error: payload.result?.isError ?? false,
      planFilePath: payload.planFilePath,
    }]
  }
  // 兼容旧的单块 {kind:...}
  if (payload.kind) return [payload]
  return []
}

function hasSendableContent(text: string, opts?: SendMessageOptions): boolean {
  return text.trim().length > 0 || (opts?.images?.length ?? 0) > 0
}

function userEchoText(text: string, opts?: SendMessageOptions): string {
  const trimmed = text.trim()
  if (trimmed) return trimmed
  return (opts?.images?.length ?? 0) > 0 ? '图片附件' : ''
}

function stripQueueMode(opts?: SendMessageOptions): Omit<SendMessageOptions, 'queueMode'> {
  const { queueMode: _queueMode, ...sendOpts } = opts ?? {}
  return sendOpts
}

export function useSessionChat(opts: UseSessionChatOptions): UseSessionChatHandle {
  const { send } = opts
  const [messages, setMessages] = useState<AnyMessage[]>([])
  const [running, setRunning] = useState(false)
  // 子代理(Task 工具)输出:按父 Task 的 toolUseId 聚合其内部块(text/工具)。
  // 来自 subagent-output 转发的 session.blocks(payload.op=tool_use_start 且带 payload.toolUseId)。
  // ChatPage 据此在 Task tool_use 展开时内嵌显示子代理过程,不污染主流 blocks。
  const [subagentOutput, setSubagentOutput] = useState<Record<string, ChatBlock[]>>({})
  // 编辑重发态:正在编辑的 user 消息 index(null=非编辑态)。仅最后一条 user 可编辑。
  const [editingIndex, setEditing] = useState<number | null>(null)
  const [hasMoreHistory, setHasMoreHistory] = useState(false)
  // 历史灌入计数：每次 session.history 到达 +1。供 UI 感知「这是一次历史到达」，
  // 触发强制滚动到底（历史异步到达，messages 变化不足以区分历史 vs 流式）。
  const [historyVersion, setHistoryVersion] = useState(0)
  // 当前轮次是否已收尾（收到 session.result）。true 时下一条 delta/blocks 强制开新 assistant 消息。
  const finishedRef = useRef(true)
  // 已处理的 assistant_blocks uuid 集合(轮次去重):同一 uuid 的重复事件(resume/重放)跳过,
  // 不同 uuid 是不同轮 → 追加而非替换(消除多轮文本覆盖)。session.result 后清空。
  const seenUuidsRef = useRef<Set<string>>(new Set())
  // 排队模式:流式中 queue 模式发送的消息暂存队列,AI 结束后自动发队首。
  const [queue, setQueue] = useState<QueuedMessage[]>([])
  // 自动出队的 useEffect 需 localSessionId,但 hook 不持有它(sendMessage 参数传入)。
  // 用 ref 缓存最近一次 sendMessage 的 localSessionId,供出队 useEffect 使用。
  const localSessionIdRef = useRef<string>('')

  const onInbound = useCallback(
    (env: Envelope) => {
      // 调试：确认 onInbound 收到了事件
      if (env.type === 'session.delta' || env.type === 'session.blocks' || env.type === 'session.result') {
        console.warn('[chat-inbound]', env.type, JSON.stringify(env.payload).slice(0, 120))
      }
      if (env.type === 'session.history') {
        // 历史灌入：把桌面下发的 items 作为已完成轮次前置到消息列表（不触发 running）。
        const p = env.payload as { items?: HistoryItem[]; hasMore?: boolean }
        const items = Array.isArray(p.items) ? p.items : []
        const mapped: AnyMessage[] = items.map((it) => {
          if (it.role === 'user') return { role: 'user', text: it.text ?? '' }
          // 历史转有序 content:thinking → text → blocks(历史无交错,这样足够)。
          const content: ChatBlock[] = []
          const thinking = (it.thinking ?? '').replace(/^[\r\n]+/, '').replace(/[\r\n]+$/, '')
          if (thinking) content.push({ kind: 'thinking', label: '', text: thinking, raw: null })
          const text = (it.text ?? '').replace(/^[\r\n]+/, '').replace(/[\r\n]+$/, '')
          if (text) content.push({ kind: 'text', label: '', text, raw: null })
          for (const b of (it.blocks ?? [])) content.push({ ...b, raw: null })
          return { role: 'assistant', content }
        })
        setMessages((prev) => [...mapped, ...prev])
        setHasMoreHistory(!!p.hasMore)
        setHistoryVersion((v) => v + 1) // 通知 UI：历史到达，需强制滚到底
        finishedRef.current = true // 历史都是已收尾轮次
        return
      }
      if (env.type === 'session.delta') {
        const p = env.payload as { text?: string; thinking?: string }
        setRunning(true)
        const startNew = finishedRef.current
        finishedRef.current = false
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          if (!startNew && last && last.role === 'assistant') {
            const next = [...prev]
            next[prev.length - 1] = appendDelta(last, p)
            return next
          }
          return [...prev, appendDelta(mkMessage(), p)]
        })
        return
      }
      if (env.type === 'session.blocks') {
        // 子代理(Task 工具)过程块分流:subagent-output 转发的信封 payload 带 toolUseId(父 Task id)
        // 且 op=tool_use_start。这些块是子代理内部的 text/工具,不该进主流(否则污染对话流)。
        // 归入 subagentOutput[parentToolUseId],Task tool_use 展开时内嵌显示。
        // 主流 Task tool_use_start 的 payload 无 toolUseId 字段(只有 block),不会误命中。
        const ep = env.payload as any
        if (ep?.op === 'tool_use_start' && typeof ep.toolUseId === 'string' && ep.block) {
          const b = classifyBlock(ep.block)
          if (b) {
            setSubagentOutput((prev) => {
              const arr = prev[ep.toolUseId] ?? []
              return { ...prev, [ep.toolUseId]: [...arr, b] }
            })
          }
          return
        }
        setRunning(true)
        const ep2 = env.payload as any
        const op = ep2?.op
        const startNew = finishedRef.current
        finishedRef.current = false
        setMessages((prev) => {
          let working = prev
          let needNew = startNew || working[working.length - 1]?.role !== 'assistant'

          if (op === 'assistant_blocks') {
            // 整轮权威 blocks:按 uuid 去重 + 有序合入 content(mergeAssistantBlocks)。
            // 不再用 authoritativeText 替换 msg.text(那会覆盖前几轮文本)。
            const uuid = typeof ep2.uuid === 'string' ? ep2.uuid : undefined
            const incoming: ChatBlock[] = []
            for (const raw of (Array.isArray(ep2.blocks) ? ep2.blocks : [])) {
              const b = classifyBlock(raw)
              if (b && b.kind !== 'tool_result') incoming.push(b) // tool_result 不在 assistant_blocks,防御
            }
            if (needNew) { working = [...working, mkMessage()]; needNew = false }
            const cur = working.length - 1
            const msg = working[cur] as ChatMessage
            const merged = mergeAssistantBlocks(msg.content, incoming, uuid, seenUuidsRef.current)
            if (merged) {
              working = [...working.slice(0, cur), { ...msg, content: merged }, ...working.slice(cur + 1)]
            }
            return working
          }

          // tool_use_start / tool_result:逐块处理(extractBlocks 归一化)
          const blocks = extractBlocks(env.payload)
          for (const raw of blocks) {
            const b = classifyBlock(raw)
            if (!b) continue
            if (needNew) { working = [...working, mkMessage()]; needNew = false }
            const cur = working.length - 1
            const msg = working[cur] as ChatMessage
            if (b.kind === 'tool_result' && b.id) {
              // tool_result 合并进同 id 的 tool_use(更新 result/status)。孤儿(无匹配 tool_use,
              // 如 AskUserQuestion/ExitPlanMode)静默丢弃——mergeToolResult 找不到时返回原 content。
              const merged = mergeToolResult(msg.content, b.id, b.result!)
              working = [...working.slice(0, cur), { ...msg, content: merged }, ...working.slice(cur + 1)]
            } else if (b.kind === 'tool_result') {
              continue // tool_result 无 id(异常):丢弃
            } else {
              // tool_use / plan / text 块:追加到 content 末尾(保留交错顺序)
              working = [...working.slice(0, cur), appendBlock(msg, b), ...working.slice(cur + 1)]
            }
          }
          return working
        })
        return
      }
      if (env.type === 'session.result') {
        setRunning(false)
        finishedRef.current = true // 收尾：下一次 delta 开新轮次
        seenUuidsRef.current = new Set() // 新 query:清轮次去重,允许新一轮 assistant_blocks 合入
        return
      }
      if (env.type === 'session.notice') {
        const p = env.payload as { text?: string; level?: 'info' | 'warn' | 'error'; kind?: string }
        const noticeText = typeof p.text === 'string' ? p.text : ''
        if (noticeText.trim()) {
          setMessages((prev) => [...prev, {
            role: 'notice',
            text: noticeText,
            level: p.level,
            kind: p.kind,
          }])
        }
        return
      }
      // 其余信封不在本 hook 关注范围
    },
    [],
  )

  const sendMessage = useCallback(
    async (
      localSessionId: string,
      text: string,
      opts?: SendMessageOptions,
    ) => {
      const trimmed = text.trim()
      if (!hasSendableContent(text, opts)) return false
      localSessionIdRef.current = localSessionId
      // 剔除 queueMode(协议层不需要,不该透传给 session.message)
      const sendOpts = stripQueueMode(opts)
      const echoText = userEchoText(text, opts)
      // 流式中按 queueMode 处理(非流式直接发)
      if (running) {
        if (opts?.queueMode === 'queue') {
          // queue:进队列,不直接发(等 AI 结束自动出队)
          setQueue((prev) => [...prev, { text: trimmed, opts: sendOpts }])
          return true
        }
        if (opts?.queueMode === 'guide') {
          // guide:中断当前 AI,200ms 后立即发(确保 SDK 中断完成)
          const interrupted = await send('session.interrupt', { localSessionId })
          if (!interrupted) return false
          setTimeout(() => {
            void send('session.message', { localSessionId, text: trimmed, ...sendOpts }).then((ok) => {
              if (!ok) return
              setMessages((prev) => [...prev, { role: 'user' as const, text: echoText }, mkMessage()])
              finishedRef.current = false
              setRunning(true)
            })
          }, 200)
          return true
        }
      }
      // 非流式 / 无 queueMode:直接 echo + 发
      const ok = await send('session.message', { localSessionId, text: trimmed, ...sendOpts })
      if (!ok) return false
      setMessages((prev) => [...prev, { role: 'user' as const, text: echoText }, mkMessage()])
      finishedRef.current = false // 新 assistant 已就位，delta 续写它
      setRunning(true)
      return true
    },
    [send, running],
  )

  // 自动出队:AI 结束(running:false)且 queue 非空时,发队首 + 出队。
  // 用 localSessionIdRef 拿最近的 localSessionId(hook 不持有它)。
  useEffect(() => {
    if (!running && queue.length > 0 && localSessionIdRef.current) {
      const next = queue[0]
      setQueue((prev) => prev.slice(1))
      const localSessionId = localSessionIdRef.current
      // 出队即直接发(echo + send,不再判断 queueMode)
      void send('session.message', { localSessionId, text: next.text, ...next.opts }).then((ok) => {
        if (!ok) {
          setQueue((prev) => [next, ...prev])
          return
        }
        setMessages((prev) => [...prev, { role: 'user' as const, text: userEchoText(next.text, next.opts) }, mkMessage()])
        finishedRef.current = false
        setRunning(true)
      })
    }
  }, [running, queue, send])

  const interrupt = useCallback(
    async (localSessionId: string) => {
      await send('session.interrupt', { localSessionId })
    },
    [send],
  )

  // 编辑重发:截断 index 及之后的消息,用新文本替换该 user 消息 + 重发。
  // 内联发送(不调 sendMessage)避免重复 echo user。running 时先 interrupt。
  // SDK resume 旧会话带历史(UI 截断但 SDK 上下文完整,与桌面 EDIT_RESEND 一致)。
  const editAndResend = useCallback(
    async (localSessionId: string, index: number, newText: string) => {
      const trimmed = newText.trim()
      if (!trimmed) return
      // 1) 截断:丢弃 index 及之后所有消息,加新 user + 空 assistant(开新轮次)
      setMessages((prev) => {
        if (index < 0 || index >= prev.length || prev[index].role !== 'user') return prev
        return [...prev.slice(0, index), { role: 'user' as const, text: trimmed }, mkMessage()]
      })
      setEditing(null)
      finishedRef.current = false // 新 assistant 已就位,delta 续写它
      setRunning(true)
      // 2) 若在跑,先中断当前流(避免并发)
      if (running) {
        await send('session.interrupt', { localSessionId })
      }
      // 3) 用新文本重发(resume 旧会话,带历史)
      await send('session.message', { localSessionId, text: trimmed })
    },
    [send, running],
  )

  const loadHistory = useCallback(
    async (localSessionId: string, limit = 50) => {
      await send('session.history.request', { localSessionId, limit })
    },
    [send],
  )

  const reset = useCallback(() => {
    setMessages([])
    setRunning(false)
    setHasMoreHistory(false)
    setHistoryVersion(0)
    setSubagentOutput({})
    finishedRef.current = true
    seenUuidsRef.current = new Set()
  }, [])

  return { messages, running, hasMoreHistory, historyVersion, onInbound, sendMessage, interrupt, loadHistory, reset, editingIndex, setEditing, editAndResend, queue, subagentOutput }
}
