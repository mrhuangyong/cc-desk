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
  type: Extract<MessageType, 'session.message' | 'session.interrupt'>,
  payload: unknown,
) => Promise<boolean>

export interface UseSessionChatOptions {
  send: ChatSendFn
}

export interface UseSessionChatHandle {
  /** 消息序列（user 与 assistant 交替）。 */
  messages: AnyMessage[]
  /** 是否正在流式输出（一轮未收 result）。 */
  running: boolean
  /** 入站信封处理器：挂在 useRelay 的 onInbound。仅处理 session.delta/blocks/result。 */
  onInbound(env: Envelope): void
  /** 发送用户消息：本地 echo user 消息 + 发 session.message + 进入 running。 */
  sendMessage(localSessionId: string, text: string): Promise<void>
  /** 中断当前 query。 */
  interrupt(localSessionId: string): Promise<void>
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
  // 当前轮次是否已收尾（收到 session.result）。true 时下一条 delta/blocks 强制开新 assistant 消息。
  // 用 ref 而非 state：它只在 onInbound 内部读，不驱动渲染；避免与 setMessages 的 functional
  // updater 混用 idx（那样 ref 会在 updater 异步执行时被污染）。
  const finishedRef = useRef(true)

  const onInbound = useCallback(
    (env: Envelope) => {
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
            working = [
              ...working.slice(0, cur),
              appendBlock(working[cur] as ChatMessage, b),
              ...working.slice(cur + 1),
            ]
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

  const reset = useCallback(() => {
    setMessages([])
    setRunning(false)
    finishedRef.current = true
  }, [])

  return { messages, running, onInbound, sendMessage, interrupt, reset }
}
