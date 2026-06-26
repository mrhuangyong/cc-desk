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
import { useCallback, useRef, useState } from 'react'
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
   *  模型切换走 session.setActiveModel（改桌面 activeModelId，sdkEnv+model 一起切换，保证一致）。 */
  sendMessage(localSessionId: string, text: string): Promise<void>
  /** 中断当前 query。 */
  interrupt(localSessionId: string): Promise<void>
  /** 拉取历史对话（attach 后调；hasMore=true 时可继续上拉）。 */
  loadHistory(localSessionId: string, limit?: number): Promise<void>
  /** 清空消息（切会话/卸载）。 */
  reset(): void
}

/** 从 session.blocks payload 取出 blocks 数组（容错）。 */
function extractBlocks(payload: any): unknown[] {
  if (!payload) return []
  // 桌面端透传 claude:blocks 的数据：可能是 { blocks: [...] } 或直接是数组。
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload.blocks)) return payload.blocks
  // 兼容单块
  if (payload.kind) return [payload]
  return []
}

export function useSessionChat(opts: UseSessionChatOptions): UseSessionChatHandle {
  const { send } = opts
  const [messages, setMessages] = useState<AnyMessage[]>([])
  const [running, setRunning] = useState(false)
  const [hasMoreHistory, setHasMoreHistory] = useState(false)
  // 历史灌入计数：每次 session.history 到达 +1。供 UI 感知「这是一次历史到达」，
  // 触发强制滚动到底（历史异步到达，messages 变化不足以区分历史 vs 流式）。
  const [historyVersion, setHistoryVersion] = useState(0)
  // 当前轮次是否已收尾（收到 session.result）。true 时下一条 delta/blocks 强制开新 assistant 消息。
  const finishedRef = useRef(true)

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
            text: it.text ?? '',
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
            // text 块追加到 message.text（而非 blocks）；其余块走 appendBlock
            if (b.kind === 'text') {
              const msg = working[cur] as ChatMessage
              working = [
                ...working.slice(0, cur),
                { ...msg, text: msg.text + (b.text ?? '') },
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
    async (localSessionId: string, text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      // 本地 echo user 消息 + 开新 assistant 轮次（下一条 delta 续到这条 assistant）
      setMessages((prev) => [...prev, { role: 'user' as const, text: trimmed }, mkMessage()])
      finishedRef.current = false // 新 assistant 已就位，delta 续写它
      setRunning(true)
      await send('session.message', { localSessionId, text: trimmed })
    },
    [send],
  )

  const interrupt = useCallback(
    async (localSessionId: string) => {
      await send('session.interrupt', { localSessionId })
    },
    [send],
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

  return { messages, running, hasMoreHistory, historyVersion, onInbound, sendMessage, interrupt, loadHistory, reset }
}
