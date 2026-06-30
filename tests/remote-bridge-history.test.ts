// tests/remote-bridge-history.test.ts
// toHistoryMessages：桌面 Message[] → 手机历史消息转换（纯函数测试）。
import { describe, it, expect } from 'vitest'
import { toHistoryMessages, type HistoryInputMessage } from '../src/main/remote-bridge'

describe('toHistoryMessages', () => {
  it('user 消息取 text，assistant 取 text+thinking+blocks（tool_result 合并进 tool_use）', () => {
    const messages: HistoryInputMessage[] = [
      { id: 'u1', role: 'user', content: [{ type: 'text', text: '帮我修 bug' }] },
      {
        id: 'a1', role: 'assistant', content: [
          { type: 'thinking', text: '分析中' },
          { type: 'text', text: '已修复' },
          { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'git status' }, status: 'completed' },
          { type: 'tool_result', tool_use_id: 'tu1', content: 'ok', isError: false },
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
    // tool_result 合并进 tool_use，不再独立成块
    expect(items[1].blocks).toHaveLength(1)
    expect(items[1].blocks?.[0]).toMatchObject({ kind: 'tool_use', label: 'Bash: git status · 完成' })
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

  it('toolUseLabel 友好化：Edit 取文件名，Bash 取首行（无配对 tool_result → 进行中）', () => {
    const messages: HistoryInputMessage[] = [
      {
        id: 'a1', role: 'assistant', content: [
          { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/a/b/c.ts' }, status: 'completed' },
          { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test\nmore' }, status: 'completed' },
          { type: 'tool_use', id: 't3', name: 'Unknown', input: {}, status: 'completed' },
        ],
      },
    ]
    const { items } = toHistoryMessages(messages)
    // 无配对 tool_result（tool_use_id 缺失）→ 状态「进行中」
    expect(items[0].blocks?.[0].label).toBe('Edit: c.ts · 进行中')
    expect(items[0].blocks?.[1].label).toBe('Bash: npm test · 进行中')
    expect(items[0].blocks?.[2].label).toBe('Unknown · 进行中')
  })

  it('tool_result 配对 tool_use：isError → 状态出错', () => {
    const messages: HistoryInputMessage[] = [
      {
        id: 'a1', role: 'assistant', content: [
          { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'npm test' }, status: 'completed' },
          { type: 'tool_result', tool_use_id: 'tu1', content: 'fail', isError: true },
        ],
      },
    ]
    const { items } = toHistoryMessages(messages)
    expect(items[0].blocks).toHaveLength(1)
    expect(items[0].blocks?.[0].label).toBe('Bash: npm test · 出错')
  })

  it('ExitPlanMode 的 is_error 视作完成（用户授权后必经的占位结果）', () => {
    const messages: HistoryInputMessage[] = [
      {
        id: 'a1', role: 'assistant', content: [
          { type: 'tool_use', id: 'tu1', name: 'ExitPlanMode', input: {}, status: 'completed' },
          { type: 'tool_result', tool_use_id: 'tu1', content: 'Exit plan mode?', isError: true },
        ],
      },
    ]
    const { items } = toHistoryMessages(messages)
    expect(items[0].blocks?.[0].label).toBe('计划批准 · 完成')
  })

  it('孤儿 tool_result（无匹配 tool_use）→ 跳过，不独立成块', () => {
    const messages: HistoryInputMessage[] = [
      { id: 'a1', role: 'assistant', content: [{ type: 'tool_result', tool_use_id: 'orphan', content: 'fail', isError: true }] },
    ]
    const { items } = toHistoryMessages(messages)
    // 无匹配 tool_use：不渲染独立 tool_result 块（避免孤立的「出错」）
    expect(items[0].blocks).toHaveLength(0)
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
