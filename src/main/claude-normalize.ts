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

// 把 tool_result 的 content（string | text-block[] | 其它）拍平为可读文本。
// extractToolResults / extractBackgroundTaskId / claude-service 的后台命令兜底共用。
export function contentToText(content: any): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((c: any) => c?.text ?? '').join('')
  return JSON.stringify(content ?? '')
}

// user message.content（含 tool_result）→ 提取可读结果
export function extractToolResults(content: any[]): { toolUseId: string; content: string; isError: boolean }[] {
  if (!Array.isArray(content)) return []
  return content
    .filter((b: any) => b.type === 'tool_result')
    .map((b: any) => ({
      toolUseId: b.tool_use_id,
      content: contentToText(b.content),
      isError: !!b.is_error,
    }))
}

// 从 tool_result block 提取 SDK 后台任务 id（Bash auto-background 场景）。
// SDK 0.3.178 的 Bash 工具：后台命令的 backgroundTaskId 藏在 content 文本里
// （"Command running in background with ID: xxx"），而非结构化字段。
export function extractBackgroundTaskId(toolResultBlock: any): string | undefined {
  if (!toolResultBlock) return undefined
  // 1) tool_result 顶层字段
  const topBg = toolResultBlock.backgroundTaskId
  if (typeof topBg === 'string' && topBg) return topBg
  // 2) structuredContent
  const sc = toolResultBlock.structuredContent
  if (sc && typeof sc === 'object' && typeof sc.backgroundTaskId === 'string' && sc.backgroundTaskId) return sc.backgroundTaskId
  // 3) content 是对象时
  const c = toolResultBlock.content
  if (c && typeof c === 'object' && !Array.isArray(c) && typeof c.backgroundTaskId === 'string' && c.backgroundTaskId) return c.backgroundTaskId
  // 4) content 文本中提取（主路径）
  const text = (typeof c === 'string' || Array.isArray(c)) ? contentToText(c) : ''
  // 4a) 结构化 JSON 兜底
  const m1 = text.match(/"backgroundTaskId"\s*:\s*"([^"]+)"/)
  if (m1) return m1[1]
  // 4b) Bash 后台命令的人类可读文本："Command running in background with ID: <id>"
  const m2 = text.match(/background with ID:\s*([A-Za-z0-9_-]+)/)
  if (m2) return m2[1]
  return undefined
}

// 从 ExitPlanMode 的 tool_result block 提取 plan 文档的磁盘路径。
// 真实 SDK 样本（~/.cc-desk/claude/projects/*.jsonl）的 tool_result 结构：
//   {
//     content: "File created successfully at: /Users/x/.cc-desk/claude/plans/foo.md ...",
//     toolUseResult: { type: "create", filePath: "/Users/x/.cc-desk/claude/plans/foo.md", ... }
//   }
// 故按优先级兜底：toolUseResult.filePath（主）→ structuredContent.filePath
// → content 对象.filePath → content 文本里的 JSON / "File ... at: <path>"。
export function extractPlanFilePath(toolResultBlock: any): string | undefined {
  if (!toolResultBlock) return undefined
  // 1) toolUseResult.filePath（真实 SDK 主路径）
  const tur = toolResultBlock.toolUseResult
  if (tur && typeof tur === 'object' && typeof tur.filePath === 'string' && tur.filePath) return tur.filePath
  // 2) structuredContent.filePath
  const sc = toolResultBlock.structuredContent
  if (sc && typeof sc === 'object' && typeof sc.filePath === 'string' && sc.filePath) return sc.filePath
  // 3) content 是对象时
  const c = toolResultBlock.content
  if (c && typeof c === 'object' && !Array.isArray(c) && typeof c.filePath === 'string' && c.filePath) return c.filePath
  // 4) content 文本里提取
  const text = (typeof c === 'string' || Array.isArray(c)) ? contentToText(c) : ''
  // 4a) 结构化 JSON 兜底
  const m1 = text.match(/"filePath"\s*:\s*"([^"]+)"/)
  if (m1) return m1[1]
  // 4b) 人类可读文本："File created/updated successfully at: <path>"
  const m2 = text.match(/File\s+(?:created|updated)\s+successfully\s+at:\s*(\/\S+\.md)/i)
  if (m2) return m2[1]
  return undefined
}
