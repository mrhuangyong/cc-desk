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

/** 一条 chat 消息（assistant）。
 *  content 是有序数组：text / thinking / tool_use / plan 交错保留（对齐桌面 Message.content）。
 *  此前用 text + thinking + blocks 三字段,丢失了 SDK content 的交错顺序(分组根因)
 *  + 多轮 assistant 文本互相覆盖(每轮 assistant_blocks 替换整个 msg.text)。改有序数组根治。 */
export interface ChatMessage {
  role: 'assistant'
  content: ChatBlock[]
}

/** 渲染块（从 session.blocks 归一化而来）。 */
export interface ChatBlock {
  kind: 'tool_use' | 'tool_result' | 'plan' | 'assistant' | 'text' | 'thinking'
  label: string
  text?: string  // text/thinking 块的文本内容
  id?: string    // tool_use 的 id（合并 tool_result 的匹配键）/ tool_result 内部载体的 tool_use_id
  name?: string  // tool_use 的工具名（status 判定用，如 ExitPlanMode 特例）
  status?: 'running' | 'completed' | 'error'  // tool_use 执行状态（tool_result 合并后更新）
  result?: { content: unknown; isError: boolean }  // 合并进 tool_use 的 tool_result（内部载体用）
  raw: unknown
}

/** 构造空 assistant 消息。 */
export function mkMessage(): ChatMessage {
  return { role: 'assistant', content: [] }
}

/** session.delta payload 的结构（text / thinking 二选一，见 forwarder.onClaudeDelta）。 */
interface DeltaPayload {
  text?: string
  thinking?: string
}

/** 把流式 delta 累加到消息；返回新消息（不可变）。
 *  追加到 content 末尾的【同类型块】:末尾是 text 则拼接,否则 push 新 text 块(thinking 同理)。
 *  首个非空 delta 会去除前导换行（SDK 首个 chunk 常以 \n 开头,pre-wrap 会渲染成顶部空行）。 */
export function appendDelta(m: ChatMessage, delta: DeltaPayload): ChatMessage {
  const hasText = typeof delta.text === 'string' && delta.text.length > 0
  const hasThinking = typeof delta.thinking === 'string' && delta.thinking.length > 0
  if (!hasText && !hasThinking) return m
  let content = m.content
  if (hasText) {
    const last = content[content.length - 1]
    const isFirst = !(last?.kind === 'text' && (last.text ?? '').length > 0)
    const piece = isFirst ? delta.text!.replace(/^[\r\n]+/, '') : delta.text!
    content = isFirst
      ? [...content, { kind: 'text', label: '', text: piece, raw: null }]
      : [...content.slice(0, -1), { ...last, text: (last.text ?? '') + piece }]
  }
  if (hasThinking) {
    const last = content[content.length - 1]
    const isFirst = !(last?.kind === 'thinking' && (last.text ?? '').length > 0)
    const piece = isFirst ? delta.thinking!.replace(/^[\r\n]+/, '') : delta.thinking!
    content = isFirst
      ? [...content, { kind: 'thinking', label: '', text: piece, raw: null }]
      : [...content.slice(0, -1), { ...last, text: (last.text ?? '') + piece }]
  }
  return { ...m, content }
}

/** 追加一个块到消息末尾（append-only）。 */
export function appendBlock(m: ChatMessage, block: ChatBlock): ChatMessage {
  return { ...m, content: [...m.content, block] }
}

/**
 * 把 tool_result 合并进 content 里同 id 的 tool_use 块（更新 result + status）。
 * 对齐桌面端 reducer STREAM_TOOL_RESULT（src/renderer/state/reducer.ts）：
 *   - 按 tool_use_id 找 tool_use 块，找不到（孤儿）返回原数组——调用方据此丢弃。
 *   - ExitPlanMode 的 is_error 是 SDK 退出 plan 模式时回填的占位结果（用户授权后必经），
 *     不代表计划失败，视作 completed（与桌面 reducer 一致，避免红点误导）。
 *
 * @returns 新 content 数组。若 id 无匹配 tool_use，原样返回（孤儿）。
 */
export function mergeToolResult(
  content: ChatBlock[],
  id: string,
  result: { content: unknown; isError: boolean },
): ChatBlock[] {
  const idx = content.findIndex((b) => b.kind === 'tool_use' && b.id === id)
  if (idx < 0) return content // 孤儿 tool_result：保持不变，调用方丢弃
  const tu = content[idx]
  const isError = result.isError && tu.name !== 'ExitPlanMode'
  const updated: ChatBlock = {
    ...tu,
    result,
    status: isError ? 'error' : 'completed',
  }
  return [...content.slice(0, idx), updated, ...content.slice(idx + 1)]
}

/**
 * 把一轮 assistant_blocks（权威版）有序合入 content。对齐桌面 STREAM_ASSISTANT_BLOCKS。
 *
 * - uuid 去重:同一 assistant 消息(uuid)的重复事件(resume/重放)跳过,返回 null 表示无变化。
 *   不同 uuid = 不同轮,顺序追加(不再替换 → 消除多轮文本覆盖)。
 * - 草稿剥离:合入前剥离 content 末尾连续的 text/thinking 块(流式 delta 拼出的临时态),
 *   用权威版取代,否则同段文本重复。
 * - 有序合并:tool_use 按 id 去重(保留已回填的 result/status);text/thinking 末尾同类替换否则 push。
 *
 * @param incoming  本轮 assistant_blocks 归一化后的块(已过 classifyBlock,但本函数按 raw.type 重新归一化更稳)
 * @returns 新 content,或 null(uuid 已见,无变化)。
 */
export function mergeAssistantBlocks(
  content: ChatBlock[],
  incoming: ChatBlock[],
  uuid: string | undefined,
  seenUuids: Set<string>,
): ChatBlock[] | null {
  // uuid 去重:已见过本轮 → 跳过(resume/重放)。无 uuid 则不去重(保守,首次必合入)。
  if (uuid && seenUuids.has(uuid)) return null
  if (uuid) seenUuids.add(uuid)

  // 空块(本轮全是被过滤的 tool_use,如 AskUserQuestion/TodoWrite):不剥离草稿,原样返回。
  // 否则会误清掉主流已显示的流式文本(对齐桌面 reducer:638-640 空 blocks 守卫)。
  if (!incoming.length) return content

  let merged = [...content]
  // 1) 剥离末尾连续的 text/thinking 草稿块(流式临时态,将由权威版取代)
  while (merged.length) {
    const t = merged[merged.length - 1].kind
    if (t === 'text' || t === 'thinking') merged.pop()
    else break
  }
  // 2) 顺序合入 incoming
  for (const nb of incoming) {
    if (nb.kind === 'tool_use') {
      const idx = merged.findIndex((b) => b.kind === 'tool_use' && b.id === nb.id)
      if (idx >= 0) {
        // 校正 input/label,但不降级已有 status/result(对齐桌面 reducer:649)
        const old = merged[idx]
        merged[idx] = { ...nb, status: old.status ?? nb.status, result: old.result ?? nb.result }
      } else {
        merged.push(nb)
      }
    } else if (nb.kind === 'text' || nb.kind === 'thinking') {
      // 去前导换行(SDK 权威版 text 常以 \n 开头,移动端 pre-wrap 会渲染成顶部空行)
      const text = (nb.text ?? '').replace(/^[\r\n]+/, '')
      const cleaned = { ...nb, text }
      // 末尾同类替换(权威版),否则 push
      const last = merged[merged.length - 1]
      if (last && last.kind === nb.kind) merged[merged.length - 1] = cleaned
      else merged.push(cleaned)
    } else if (nb.kind === 'plan') {
      merged.push(nb)
    }
    // tool_result/assistant 内部载体不在 assistant_blocks 里出现,忽略
  }
  return merged
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
    const id = typeof raw.id === 'string' ? raw.id : undefined
    // 初始 running，待对应 tool_result 到达后由 mergeToolResult 更新为 completed/error
    return { kind: 'tool_use', label: toolUseLabel(name, raw.input), id, name, status: 'running', raw }
  }
  // tool_result 块(SDK type:'tool_result' 或旧 kind:'tool_result')
  // 不再生成独立渲染块——返回内部载体（带 id + result），由 useSessionChat 调 mergeToolResult
  // 合并进同 id 的 tool_use。找不到对应块的孤儿（AskUserQuestion/ExitPlanMode 等被过滤的工具）
  // 由调用方丢弃，避免显示误导性的 [完成]/[出错]（对齐桌面 BlockRenderer 对 tool_result 返回 null）。
  if (raw.type === 'tool_result' || raw.kind === 'tool_result') {
    // 计划卡片(tool_result 带 plan payload)仍作为独立 plan 块渲染
    if (isPlanCard(raw)) return { kind: 'plan', label: '计划', raw }
    const id = typeof (raw.tool_use_id ?? raw.toolUseId) === 'string' ? (raw.tool_use_id ?? raw.toolUseId) : undefined
    const isError = raw.is_error ?? raw.isError ?? false
    const content = raw.content ?? raw.result?.content ?? ''
    // label 留空：此块仅供合并逻辑识别，不会被渲染（handler 走 mergeToolResult 分支）
    return { kind: 'tool_result', label: '', id, result: { content, isError }, raw }
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
