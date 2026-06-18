// 主进程：把 SDK message 的结构拍平为渲染端用的 ContentBlock / SystemNotice。

export interface NormToolUse {
  type: 'tool_use'
  id: string
  name: string
  input: any
  status: 'running' | 'completed' | 'error'
  result?: { content: string; isError: boolean }
}
export interface NormBlock {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'image'
  [k: string]: any
}
export interface SystemNotice {
  id: string
  kind: string
  text: string
  level: 'info' | 'warn' | 'error'
}

let _id = 0
function nextId(prefix: string): string {
  _id += 1
  return `${prefix}${_id}`
}

export function mkNotice(kind: SystemNotice['kind'], text: string, level: SystemNotice['level']): SystemNotice {
  return { id: nextId('n'), kind, text, level }
}

// BetaMessage.content → ContentBlock[]（tool_use 默认 running，结果由 tool_result 回填）
export function normalizeBetaBlocks(content: any[]): NormBlock[] {
  if (!Array.isArray(content)) return []
  return content.map((b: any): NormBlock => {
    switch (b.type) {
      case 'text': return { type: 'text', text: b.text ?? '' }
      case 'thinking': return { type: 'thinking', text: b.thinking ?? '' }
      case 'tool_use': return { type: 'tool_use', id: b.id, name: b.name, input: b.input, status: 'running' as const }
      case 'image': return { type: 'image', source: b.source?.data ?? '' }
      default: return { type: 'text', text: JSON.stringify(b) }
    }
  })
}

// user message.content（含 tool_result）→ 提取可读结果
export function extractToolResults(content: any[]): { toolUseId: string; content: string; isError: boolean }[] {
  if (!Array.isArray(content)) return []
  return content
    .filter((b: any) => b.type === 'tool_result')
    .map((b: any) => {
      let text = ''
      if (typeof b.content === 'string') text = b.content
      else if (Array.isArray(b.content)) text = b.content.map((c: any) => c?.text ?? '').join('')
      else text = JSON.stringify(b.content ?? '')
      return { toolUseId: b.tool_use_id, content: text, isError: !!b.is_error }
    })
}

// 从 tool_result block 提取 SDK 后台任务 id（Bash 自动后台化场景）。
// 尝试多个可能位置：顶层 backgroundTaskId 字段、content 文本中的 JSON、structuredContent。
export function extractBackgroundTaskId(toolResultBlock: any): string | undefined {
  if (!toolResultBlock) return undefined
  // 1) 顶层字段（SDK 可能把 backgroundTaskId 提升到 tool_result wrapper）
  if (typeof toolResultBlock.backgroundTaskId === 'string' && toolResultBlock.backgroundTaskId) return toolResultBlock.backgroundTaskId
  // 2) structuredContent（部分输出类型用此字段）
  const sc = toolResultBlock.structuredContent
  if (sc && typeof sc === 'object' && typeof sc.backgroundTaskId === 'string' && sc.backgroundTaskId) return sc.backgroundTaskId
  // 3) content 文本中 JSON 兜底
  let text = ''
  const c = toolResultBlock.content
  if (typeof c === 'string') text = c
  else if (Array.isArray(c)) text = c.map((x: any) => x?.text ?? '').join('')
  const m = text.match(/"backgroundTaskId"\s*:\s*"([^"]+)"/)
  if (m) return m[1]
  return undefined
}
