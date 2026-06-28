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
} from '../lib/chat-blocks'

/** 用户消息（与 ChatMessage 区分：role=user，无 blocks/thinking）。 */
export interface UserMessage {
  role: 'user'
  text: string
}
export type AnyMessage = ChatMessage | UserMessage

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
    opts?: {
      permission?: string
      thinking?: 'low' | 'medium' | 'high'
      extraDirs?: string[]
      images?: { mediaType: string; data: string; name?: string }[]
      queueMode?: 'queue' | 'guide'
    },
  ): Promise<void>
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
  queue: string[]
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

export function useSessionChat(opts: UseSessionChatOptions): UseSessionChatHandle {
  const { send } = opts
  const [messages, setMessages] = useState<AnyMessage[]>([])
  const [running, setRunning] = useState(false)
  // 编辑重发态:正在编辑的 user 消息 index(null=非编辑态)。仅最后一条 user 可编辑。
  const [editingIndex, setEditing] = useState<number | null>(null)
  const [hasMoreHistory, setHasMoreHistory] = useState(false)
  // 历史灌入计数：每次 session.history 到达 +1。供 UI 感知「这是一次历史到达」，
  // 触发强制滚动到底（历史异步到达，messages 变化不足以区分历史 vs 流式）。
  const [historyVersion, setHistoryVersion] = useState(0)
  // 当前轮次是否已收尾（收到 session.result）。true 时下一条 delta/blocks 强制开新 assistant 消息。
  const finishedRef = useRef(true)
  // 排队模式:流式中 queue 模式发送的消息暂存队列,AI 结束后自动发队首。
  const [queue, setQueue] = useState<string[]>([])
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
          return {
            role: 'assistant',
            // trim 首尾换行（防御：磁盘数据可能残留前导换行，移动端 pre-wrap 会显示空行）
            text: (it.text ?? '').replace(/^[\r\n]+/, '').replace(/[\r\n]+$/, ''),
            thinking: it.thinking ?? '',
            blocks: (it.blocks ?? []).map((b) => ({ ...b, raw: null })),
          }
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
        setRunning(true)
        const blocks = extractBlocks(env.payload)
        const startNew = finishedRef.current
        finishedRef.current = false
        // 先把本轮 assistant_blocks 里的所有 text 块聚合成权威文本。
        // delta 流式只是这段文本的实时前体，assistant_blocks 到来时是权威完整版——
        // 若直接追加到 msg.text 会导致同一段文本显示两次（delta 拼一次 + 权威版再拼一次）。
        // 故权威版替换流式草稿（对齐桌面端 STREAM_ASSISTANT_BLOCKS 的去重语义）。
        const authoritativeText = blocks
          .filter((raw: any) => raw?.type === 'text' && typeof raw.text === 'string')
          .map((raw: any) => raw.text)
          .join('')
          // 去除整段首尾换行（SDK 的 text 块常以 \n 开头，移动端 pre-wrap 会渲染成空行）
          .replace(/^[\r\n]+/, '')
          .replace(/[\r\n]+$/, '')
        setMessages((prev) => {
          let working = prev
          let needNew = startNew || working[working.length - 1]?.role !== 'assistant'
          for (const raw of blocks) {
            const b = classifyBlock(raw)
            if (!b) continue
            if (needNew) {
              working = [...working, mkMessage()]
              needNew = false
            }
            const cur = working.length - 1
            if (b.kind === 'text') {
              const msg = working[cur] as ChatMessage
              // 权威版替换流式草稿（不追加），避免重复
              working = [
                ...working.slice(0, cur),
                { ...msg, text: authoritativeText },
                ...working.slice(cur + 1),
              ]
            } else {
              working = [
                ...working.slice(0, cur),
                appendBlock(working[cur] as ChatMessage, b),
                ...working.slice(cur + 1),
              ]
            }
          }
          return working
        })
        return
      }
      if (env.type === 'session.result') {
        setRunning(false)
        finishedRef.current = true // 收尾：下一次 delta 开新轮次
        return
      }
      // 其余信封（session.notice 等）不在本 hook 关注范围
    },
    [],
  )

  const sendMessage = useCallback(
    async (
      localSessionId: string,
      text: string,
      opts?: {
        permission?: string
        thinking?: 'low' | 'medium' | 'high'
        extraDirs?: string[]
        images?: { mediaType: string; data: string; name?: string }[]
        queueMode?: 'queue' | 'guide'
      },
    ) => {
      const trimmed = text.trim()
      if (!trimmed) return
      localSessionIdRef.current = localSessionId
      // 剔除 queueMode(协议层不需要,不该透传给 session.message)
      const { queueMode: _qm, ...sendOpts } = opts ?? {}
      // 流式中按 queueMode 处理(非流式直接发)
      if (running) {
        if (opts?.queueMode === 'queue') {
          // queue:进队列,不直接发(等 AI 结束自动出队)
          setQueue((prev) => [...prev, trimmed])
          return
        }
        if (opts?.queueMode === 'guide') {
          // guide:中断当前 AI,200ms 后立即发(确保 SDK 中断完成)
          await send('session.interrupt', { localSessionId })
          setTimeout(() => {
            setMessages((prev) => [...prev, { role: 'user' as const, text: trimmed }, mkMessage()])
            finishedRef.current = false
            setRunning(true)
            void send('session.message', { localSessionId, text: trimmed })
          }, 200)
          return
        }
      }
      // 非流式 / 无 queueMode:直接 echo + 发
      setMessages((prev) => [...prev, { role: 'user' as const, text: trimmed }, mkMessage()])
      finishedRef.current = false // 新 assistant 已就位，delta 续写它
      setRunning(true)
      await send('session.message', { localSessionId, text: trimmed, ...sendOpts })
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
      setMessages((prev) => [...prev, { role: 'user' as const, text: next }, mkMessage()])
      finishedRef.current = false
      setRunning(true)
      void send('session.message', { localSessionId, text: next })
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
    finishedRef.current = true
  }, [])

  return { messages, running, hasMoreHistory, historyVersion, onInbound, sendMessage, interrupt, loadHistory, reset, editingIndex, setEditing, editAndResend, queue }
}
