// web/src/lib/chat-blocks.test.ts
// ChatPage 的消息块/流式文本累积逻辑测试（Task 14）。
//
// 关注纯逻辑：session.delta 流式拼接、session.blocks 块累加、
// 计划卡片识别、tool_use/tool_result。组件渲染关注点（展示）在 .test.tsx 里测。
import { describe, it, expect } from 'vitest'
import {
  type ChatMessage,
  type ChatBlock,
  appendDelta,
  appendBlock,
  isPlanCard,
  classifyBlock,
  mergeToolResult,
  mergeAssistantBlocks,
  mkMessage,
} from './chat-blocks'

// 从 content 提取拼接后的 text/thinking(appendDelta 把它们作为有序块存进 content)
const textOf = (m: ChatMessage): string =>
  m.content.filter((b) => b.kind === 'text').map((b) => b.text ?? '').join('')
const thinkingOf = (m: ChatMessage): string =>
  m.content.filter((b) => b.kind === 'thinking').map((b) => b.text ?? '').join('')

describe('mkMessage', () => {
  it('构造一条空的 assistant 消息', () => {
    const m = mkMessage()
    expect(m.role).toBe('assistant')
    expect(m.content).toEqual([])
  })
})

describe('appendDelta - text', () => {
  it('text delta 累加到末尾 text 块', () => {
    let m = mkMessage()
    m = appendDelta(m, { text: 'hello' })
    m = appendDelta(m, { text: ' world' })
    expect(textOf(m)).toBe('hello world')
  })

  it('text delta 不污染 thinking', () => {
    let m = mkMessage()
    m = appendDelta(m, { text: 'a' })
    expect(thinkingOf(m)).toBe('')
  })
})

describe('appendDelta - thinking', () => {
  it('thinking delta 累加到末尾 thinking 块', () => {
    let m = mkMessage()
    m = appendDelta(m, { thinking: '思考' })
    m = appendDelta(m, { thinking: '中' })
    expect(thinkingOf(m)).toBe('思考中')
  })

  it('thinking delta 不污染 text', () => {
    let m = mkMessage()
    m = appendDelta(m, { thinking: 'x' })
    expect(textOf(m)).toBe('')
  })

  it('空 delta 不改动消息', () => {
    const m = mkMessage()
    const m2 = appendDelta(m, {})
    expect(m2).toBe(m)
  })
})

describe('appendBlock', () => {
  it('追加块到末尾', () => {
    const m = mkMessage()
    const m2 = appendBlock(m, { kind: 'tool_use', label: 'Read', raw: { id: 't1' } })
    expect(m2.content).toHaveLength(1)
    expect(m2.content[0].kind).toBe('tool_use')
  })

  it('保留已有块（append-only）', () => {
    let m = mkMessage()
    m = appendBlock(m, { kind: 'tool_use', label: 'A', raw: {} })
    m = appendBlock(m, { kind: 'tool_result', label: 'B', raw: {} })
    expect(m.content.map((b) => b.label)).toEqual(['A', 'B'])
  })
})

describe('classifyBlock', () => {
  it('kind=tool_use_start → tool_use 块', () => {
    const b = classifyBlock({ kind: 'tool_use_start', name: 'Read', id: 't1' })
    expect(b?.kind).toBe('tool_use')
    expect(b?.label).toBe('Read')
  })

  it('kind=tool_result → 内部载体（带 id + result，供合并识别，不渲染）', () => {
    const b = classifyBlock({ kind: 'tool_result', toolUseId: 't1', content: 'ok' })
    expect(b?.kind).toBe('tool_result')
    expect(b?.id).toBe('t1')
    expect(b?.result).toEqual({ content: 'ok', isError: false })
    expect(b?.label).toBe('') // label 空：此块不直接渲染
  })

  it('计划卡片（tool_result.payload.plan）→ plan 块', () => {
    const b = classifyBlock({
      kind: 'tool_result',
      toolUseId: 't1',
      payload: { plan: { steps: [] } },
    })
    expect(b?.kind).toBe('plan')
  })

  it('未知 kind → null（静默忽略，最小特权）', () => {
    expect(classifyBlock({ kind: 'whatever' })).toBeNull()
    expect(classifyBlock(null)).toBeNull()
    expect(classifyBlock(undefined)).toBeNull()
  })

  // 修复:SDK 原生 type 结构(assistant_blocks 透传的 tool_use/tool_result)此前不被识别
  // (classifyBlock 只读 raw.kind,但 SDK 发 raw.type),导致移动端无工具输出。
  it('type=tool_use (SDK 原生) → tool_use 块,带可读标签 + 初始 running', () => {
    const b = classifyBlock({ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'git status' } })
    expect(b?.kind).toBe('tool_use')
    expect(b?.label).toBe('Bash: git status')
    expect(b?.id).toBe('tu1')
    expect(b?.name).toBe('Bash')
    expect(b?.status).toBe('running')
  })

  it('type=tool_result (SDK 原生) → 内部载体,isError 反映到 result', () => {
    const ok = classifyBlock({ type: 'tool_result', tool_use_id: 'tu1', content: 'done', is_error: false })
    expect(ok?.kind).toBe('tool_result')
    expect(ok?.id).toBe('tu1')
    expect(ok?.result).toEqual({ content: 'done', isError: false })
    const err = classifyBlock({ type: 'tool_result', tool_use_id: 'tu2', content: 'fail', is_error: true })
    expect(err?.result?.isError).toBe(true)
  })

  it('type=tool_use + Edit → 标签含文件名', () => {
    const b = classifyBlock({ type: 'tool_use', id: 'tu2', name: 'Edit', input: { file_path: '/a/b/c.ts' } })
    expect(b?.label).toBe('Edit: c.ts')
  })
})

describe('isPlanCard', () => {
  it('payload 含 plan 字段视为计划卡片', () => {
    expect(isPlanCard({ payload: { plan: { steps: [] } } })).toBe(true)
  })
  it('无 plan 字段非计划卡片', () => {
    expect(isPlanCard({ payload: {} })).toBe(false)
    expect(isPlanCard({})).toBe(false)
    expect(isPlanCard(null)).toBe(false)
  })
})

describe('mergeToolResult', () => {
  const toolUse = (id: string, name = 'Bash'): ChatBlock => ({
    kind: 'tool_use', label: `${name}: x`, id, name, status: 'running', raw: {},
  })

  it('同 id 的 tool_use → 合并 result + status=completed', () => {
    const blocks = [toolUse('tu1')]
    const merged = mergeToolResult(blocks, 'tu1', { content: 'ok', isError: false })
    expect(merged).toHaveLength(1)
    expect(merged[0].status).toBe('completed')
    expect(merged[0].result).toEqual({ content: 'ok', isError: false })
  })

  it('isError=true → status=error', () => {
    const blocks = [toolUse('tu1')]
    const merged = mergeToolResult(blocks, 'tu1', { content: 'fail', isError: true })
    expect(merged[0].status).toBe('error')
  })

  it('ExitPlanMode 的 is_error 视作 completed（用户授权后必经的占位结果）', () => {
    const blocks = [toolUse('tu1', 'ExitPlanMode')]
    const merged = mergeToolResult(blocks, 'tu1', { content: 'Exit plan mode?', isError: true })
    expect(merged[0].status).toBe('completed')
  })

  it('无匹配 tool_use（孤儿）→ 原样返回，调用方据此丢弃', () => {
    const blocks = [toolUse('tu1')]
    const merged = mergeToolResult(blocks, 'orphan', { content: 'x', isError: false })
    expect(merged).toBe(blocks) // 同一引用，未改动
    expect(merged).toHaveLength(1)
    expect(merged[0].status).toBe('running') // 未被合并
  })

  it('多块时只更新匹配的那一块', () => {
    const blocks = [toolUse('tu1'), toolUse('tu2')]
    const merged = mergeToolResult(blocks, 'tu2', { content: 'ok', isError: false })
    expect(merged[0].status).toBe('running')
    expect(merged[1].status).toBe('completed')
  })
})

describe('mergeAssistantBlocks', () => {
  const text = (t: string): ChatBlock => ({ kind: 'text', label: '', text: t, raw: null })

  it('不同 uuid(多轮)顺序追加:文本B 不覆盖文本A(根治多轮覆盖)', () => {
    const seen = new Set<string>()
    let content: ChatBlock[] = []
    // 轮1:文本A + 工具
    content = mergeAssistantBlocks(content, [text('文本A'), { kind: 'tool_use', label: 'Bash: ls', id: 'tu1', name: 'Bash', status: 'running', raw: {} }], 'uuid-1', seen) ?? content
    // 轮2:文本B(工具后)——不同 uuid,应追加而非覆盖
    content = mergeAssistantBlocks(content, [text('文本B')], 'uuid-2', seen) ?? content
    const texts = content.filter((b) => b.kind === 'text').map((b) => b.text)
    expect(texts).toEqual(['文本A', '文本B']) // 两段都保留
  })

  it('同 uuid 重复事件(resume/重放)跳过:返回 null 无变化', () => {
    const seen = new Set<string>(['uuid-x']) // 模拟该 uuid 已处理过(首轮已合入)
    const content: ChatBlock[] = [text('A')]
    // 同 uuid 再次到达 → null(去重,不重复合入)
    const r = mergeAssistantBlocks(content, [text('B')], 'uuid-x', seen)
    expect(r).toBeNull()
  })

  it('草稿剥离:合入权威版前,剥离末尾流式 text 草稿块(避免重复)', () => {
    const seen = new Set<string>()
    // content 末尾是流式拼出的草稿 'hello'(部分) + ' wo'(续)
    const content: ChatBlock[] = [text('hello wo')]
    // 权威版到:'hello world' → 替换草稿(末尾同类替换),而非追加
    const merged = mergeAssistantBlocks(content, [text('hello world')], 'uuid-1', seen)!
    expect(merged.filter((b) => b.kind === 'text').map((b) => b.text)).toEqual(['hello world'])
  })

  it('text 与 tool_use 交错保留(顺序不丢)', () => {
    const seen = new Set<string>()
    let content: ChatBlock[] = []
    content = mergeAssistantBlocks(content, [text('前'), { kind: 'tool_use', label: 'Read', id: 'tu1', name: 'Read', status: 'running', raw: {} }, text('后')], 'uuid-1', seen)!
    expect(content.map((b) => b.kind)).toEqual(['text', 'tool_use', 'text'])
  })
})
