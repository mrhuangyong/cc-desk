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
 * 兼容两种来源结构:
 *   - 桌面 SDK 原生(assistant_blocks 透传): {type:'text'|'tool_use'|'tool_result', ...}
 *   - 旧 claude:blocks 的 op 包装: {kind:'tool_use_start'|'tool_result', ...}
 * 未知块返回 null（静默忽略）。
 */
export function classifyBlock(raw: any): ChatBlock | null {
  if (!raw || typeof raw !== 'object') return null
  // text 块(SDK assistant_blocks 里的纯文本)
  if (raw.type === 'text' && typeof raw.text === 'string') {
    return { kind: 'text', label: '', text: raw.text, raw }
  }
  // tool_use 块(SDK type:'tool_use' 或旧 kind:'tool_use_start'):工具调用过程
  if (raw.type === 'tool_use' || raw.kind === 'tool_use_start') {
    const name = typeof raw.name === 'string' ? raw.name : 'tool'
    return { kind: 'tool_use', label: toolUseLabel(name, raw.input), raw }
  }
  // tool_result 块(SDK type:'tool_result' 或旧 kind:'tool_result'):工具执行结果
  if (raw.type === 'tool_result' || raw.kind === 'tool_result') {
    // 计划卡片(tool_result 带 plan payload)
    if (isPlanCard(raw)) return { kind: 'plan', label: '计划', raw }
    const isError = raw.is_error ?? raw.isError ?? false
    return { kind: 'tool_result', label: isError ? '出错' : '完成', raw }
  }
  if (raw.kind === 'assistant_blocks') {
    return { kind: 'assistant', label: '内容', raw }
  }
  return null
}

/** 工具入参 → 简短可读标签(对齐桌面 toolUseLabel),让 tool_use 块显示「Bash: git status」而非裸名。 */
function toolUseLabel(name: string | undefined, input: any): string {
  if (!name) return '工具调用'
  const i = input ?? {}
  if (name === 'Bash' && typeof i.command === 'string') {
    return `Bash: ${i.command.split('\n')[0].trim().slice(0, 50)}`
  }
  if ((name === 'Edit' || name === 'Write' || name === 'Read') && typeof i.file_path === 'string') {
    return `${name}: ${i.file_path.split('/').pop() ?? i.file_path}`
  }
  if (name === 'Grep' && typeof i.pattern === 'string') return `Grep: ${i.pattern.slice(0, 40)}`
  if (name === 'Glob' && typeof i.pattern === 'string') return `Glob: ${i.pattern.slice(0, 40)}`
  if (name === 'Task' && typeof i.description === 'string') return `Task: ${i.description.slice(0, 40)}`
  return name
}
