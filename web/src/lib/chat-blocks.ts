// web/src/lib/chat-blocks.ts
// ChatPage 的消息块/流式累积逻辑（Task 14）。
//
// 设计（Musk Algorithm：把累积/拼接逻辑从组件拆出来单测）：
// - session.delta 的 payload 是 { localSessionId, text? | thinking? }（见 remote-bridge forwarder
//   onClaudeDelta：text 与 thinking 互斥走独立字段）。
// - session.blocks 的 payload 是透传的 claude:blocks 数据，含 tool_use_start / assistant_blocks /
//   tool_result（计划卡片挂在 tool_result.payload.plan，与桌面端 IPC 契约一致：blocks 通道承载计划卡片，
//   不走独立通道 —— 见 CLAUDE.md）。
// - 累积语义：append-only，永不修改入参（不可变更新便于 React diff）。
//
// 与桌面端渲染端 ContentBlock 对齐（src/main/claude-normalize.ts）：
// kind 取值：tool_use_start / assistant_blocks / tool_result。计划卡片在 tool_result.payload.plan。

/** 一条 chat 消息（assistant，含流式 text + thinking + 块序列）。 */
export interface ChatMessage {
  role: 'assistant'
  text: string
  thinking: string
  blocks: ChatBlock[]
}

/** 渲染块（从 session.blocks 归一化而来）。 */
export interface ChatBlock {
  kind: 'tool_use' | 'tool_result' | 'plan' | 'assistant' | 'text'
  label: string
  text?: string  // text 块的文本内容
  raw: unknown
}

/** 构造空 assistant 消息。 */
export function mkMessage(): ChatMessage {
  return { role: 'assistant', text: '', thinking: '', blocks: [] }
}

/** session.delta payload 的结构（text / thinking 二选一，见 forwarder.onClaudeDelta）。 */
interface DeltaPayload {
  text?: string
  thinking?: string
}

/** 把流式 delta 累加到消息；返回新消息（不可变）。
 *  首个非空 delta 会去除前导换行（SDK 的首个 text chunk 常以 \n 开头，
 *  移动端 CSS pre-wrap 会把它渲染成顶部空行）；中间换行保留。 */
export function appendDelta(m: ChatMessage, delta: DeltaPayload): ChatMessage {
  const hasText = typeof delta.text === 'string' && delta.text.length > 0
  const hasThinking = typeof delta.thinking === 'string' && delta.thinking.length > 0
  if (!hasText && !hasThinking) return m
  // 消息 text 还为空时，本次是首个 text chunk —— 去掉它的前导换行（避免顶部空行）
  const textDelta = hasText && m.text.length === 0 ? delta.text!.replace(/^[\r\n]+/, '') : delta.text
  // thinking 同理（首个思考片段去前导换行）
  const thinkingDelta = hasThinking && m.thinking.length === 0 ? delta.thinking!.replace(/^[\r\n]+/, '') : delta.thinking
  return {
    ...m,
    text: hasText ? m.text + textDelta : m.text,
    thinking: hasThinking ? m.thinking + thinkingDelta : m.thinking,
  }
}

/** 追加一个块到消息末尾（append-only）。 */
export function appendBlock(m: ChatMessage, block: ChatBlock): ChatMessage {
  return { ...m, blocks: [...m.blocks, block] }
}

/** 判断块 payload 是否为计划卡片（tool_result.payload.plan，与桌面端契约对齐）。 */
export function isPlanCard(raw: any): boolean {
  if (!raw || typeof raw !== 'object') return false
  const payload = (raw as any).payload
  return !!payload && typeof payload === 'object' && 'plan' in payload
}

/**
 * 把 session.blocks 的单个块归一化为 ChatBlock。
 * 未知 kind 返回 null（静默忽略，最小特权）。
 */
export function classifyBlock(raw: any): ChatBlock | null {
  if (!raw || typeof raw !== 'object') return null
  // assistant_blocks 中的 text 块（{type:'text', text:'...'}）：提取文本内容
  if (raw.type === 'text' && typeof raw.text === 'string') {
    return { kind: 'text', label: '', text: raw.text, raw }
  }
  const kind = raw.kind
  // 计划卡片优先识别（挂在 tool_result.payload.plan）
  if (kind === 'tool_result' && isPlanCard(raw)) {
    return { kind: 'plan', label: '计划', raw }
  }
  switch (kind) {
    case 'tool_use_start':
      return { kind: 'tool_use', label: typeof raw.name === 'string' ? raw.name : 'tool', raw }
    case 'tool_result':
      return { kind: 'tool_result', label: '结果', raw }
    case 'assistant_blocks':
      return { kind: 'assistant', label: '内容', raw }
    default:
      return null
  }
}
