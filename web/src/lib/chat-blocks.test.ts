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
  mkMessage,
} from './chat-blocks'

describe('mkMessage', () => {
  it('构造一条空的 assistant 消息', () => {
    const m = mkMessage()
    expect(m.role).toBe('assistant')
    expect(m.text).toBe('')
    expect(m.thinking).toBe('')
    expect(m.blocks).toEqual([])
  })
})

describe('appendDelta - text', () => {
  it('text delta 累加到 message.text', () => {
    let m = mkMessage()
    m = appendDelta(m, { text: 'hello' })
    m = appendDelta(m, { text: ' world' })
    expect(m.text).toBe('hello world')
  })

  it('text delta 不污染 thinking', () => {
    let m = mkMessage()
    m = appendDelta(m, { text: 'a' })
    expect(m.thinking).toBe('')
  })
})

describe('appendDelta - thinking', () => {
  it('thinking delta 累加到 message.thinking', () => {
    let m = mkMessage()
    m = appendDelta(m, { thinking: '思考' })
    m = appendDelta(m, { thinking: '中' })
    expect(m.thinking).toBe('思考中')
  })

  it('thinking delta 不污染 text', () => {
    let m = mkMessage()
    m = appendDelta(m, { thinking: 'x' })
    expect(m.text).toBe('')
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
    expect(m2.blocks).toHaveLength(1)
    expect(m2.blocks[0].kind).toBe('tool_use')
  })

  it('保留已有块（append-only）', () => {
    let m = mkMessage()
    m = appendBlock(m, { kind: 'tool_use', label: 'A', raw: {} })
    m = appendBlock(m, { kind: 'tool_result', label: 'B', raw: {} })
    expect(m.blocks.map((b) => b.label)).toEqual(['A', 'B'])
  })
})

describe('classifyBlock', () => {
  it('kind=tool_use_start → tool_use 块', () => {
    const b = classifyBlock({ kind: 'tool_use_start', name: 'Read', id: 't1' })
    expect(b?.kind).toBe('tool_use')
    expect(b?.label).toBe('Read')
  })

  it('kind=tool_result → tool_result 块', () => {
    const b = classifyBlock({ kind: 'tool_result', toolUseId: 't1', content: 'ok' })
    expect(b?.kind).toBe('tool_result')
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
