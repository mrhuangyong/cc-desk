// tests/remote-bridge-history.test.ts
// toHistoryMessages：桌面 Message[] → 手机历史消息转换（纯函数测试）。
import { describe, it, expect } from 'vitest'
import { toHistoryMessages, type HistoryInputMessage } from '../src/main/remote-bridge'

describe('toHistoryMessages', () => {
  it('user 消息取 text，assistant 取 text+thinking+blocks', () => {
    const messages: HistoryInputMessage[] = [
      { id: 'u1', role: 'user', content: [{ type: 'text', text: '帮我修 bug' }] },
      {
        id: 'a1', role: 'assistant', content: [
          { type: 'thinking', text: '分析中' },
          { type: 'text', text: '已修复' },
          { type: 'tool_use', name: 'Bash', input: { command: 'git status' }, status: 'completed' },
          { type: 'tool_result', content: 'ok', isError: false },
        ],
      },
    ]
    const { items, hasMore } = toHistoryMessages(messages)
    expect(hasMore).toBe(false)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ role: 'user', text: '帮我修 bug' })
    expect(items[1].role).toBe('assistant')
    expect(items[1].text).toBe('已修复')
    expect(items[1].thinking).toBe('分析中')
    expect(items[1].blocks).toHaveLength(2)
    expect(items[1].blocks?.[0]).toMatchObject({ kind: 'tool_use', label: 'Bash: git status' })
    expect(items[1].blocks?.[1]).toMatchObject({ kind: 'tool_result', label: '完成' })
  })

  it('ExitPlanMode 工具调用 → plan 块', () => {
    const messages: HistoryInputMessage[] = [
      {
        id: 'a1', role: 'assistant', content: [
          { type: 'tool_use', name: 'ExitPlanMode', input: {}, status: 'completed', planFilePath: '/x/plan.md' },
        ],
      },
    ]
    const { items } = toHistoryMessages(messages)
    expect(items[0].blocks?.[0]).toMatchObject({ kind: 'plan', label: '计划' })
  })

  it('toolUseLabel 友好化：Edit 取文件名，Bash 取首行', () => {
    const messages: HistoryInputMessage[] = [
      {
        id: 'a1', role: 'assistant', content: [
          { type: 'tool_use', name: 'Edit', input: { file_path: '/a/b/c.ts' }, status: 'completed' },
          { type: 'tool_use', name: 'Bash', input: { command: 'npm test\nmore' }, status: 'completed' },
          { type: 'tool_use', name: 'Unknown', input: {}, status: 'completed' },
        ],
      },
    ]
    const { items } = toHistoryMessages(messages)
    expect(items[0].blocks?.[0].label).toBe('Edit: c.ts')
    expect(items[0].blocks?.[1].label).toBe('Bash: npm test')
    expect(items[0].blocks?.[2].label).toBe('Unknown')
  })

  it('tool_result 出错 → label=出错', () => {
    const messages: HistoryInputMessage[] = [
      { id: 'a1', role: 'assistant', content: [{ type: 'tool_result', content: 'fail', isError: true }] },
    ]
    const { items } = toHistoryMessages(messages)
    expect(items[0].blocks?.[0].label).toBe('出错')
  })

  it('limit 分页：超限时取最后 N 条，hasMore=true', () => {
    const messages: HistoryInputMessage[] = Array.from({ length: 10 }, (_, i) => ({
      id: `u${i}`, role: 'user' as const, content: [{ type: 'text' as const, text: `msg${i}` }],
    }))
    const { items, hasMore } = toHistoryMessages(messages, 5)
    expect(hasMore).toBe(true)
    expect(items).toHaveLength(5)
    expect(items[0].text).toBe('msg5') // 取最后 5 条
  })

  it('未超限 → hasMore=false', () => {
    const messages: HistoryInputMessage[] = [
      { id: 'u1', role: 'user', content: [{ type: 'text', text: 'a' }] },
    ]
    expect(toHistoryMessages(messages, 50).hasMore).toBe(false)
  })

  it('跳过空消息（content 全空 text）', () => {
    const messages: HistoryInputMessage[] = [
      { id: 'u1', role: 'user', content: [{ type: 'text', text: '' }] }, // 空
      { id: 'u2', role: 'user', content: [{ type: 'text', text: '有效' }] },
    ]
    const { items } = toHistoryMessages(messages)
    expect(items).toHaveLength(1)
    expect(items[0].text).toBe('有效')
  })

  it('空 user 文本回退为 (空消息)', () => {
    // content 只有 tool_result 的 user（理论上少见），text 为空 → 回退
    const messages: HistoryInputMessage[] = [
      { id: 'u1', role: 'user', content: [{ type: 'tool_result', content: 'x', isError: false }] },
    ]
    const { items } = toHistoryMessages(messages)
    // 这种 user 无 text block，被当成空文本
    expect(items[0].text).toBe('(空消息)')
  })
})
