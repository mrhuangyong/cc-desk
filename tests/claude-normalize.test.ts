import { describe, it, expect } from 'vitest'
import { normalizeBetaBlocks, extractToolResults, extractBackgroundTaskId, mkNotice } from '../src/main/claude-normalize'

describe('normalizeBetaBlocks', () => {
  it('把 BetaMessage content blocks 映射为 ContentBlock[]', () => {
    const input = [
      { type: 'text', text: 'hello' },
      { type: 'thinking', thinking: 'hmm' },
      { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: 'a' } },
    ]
    const out = normalizeBetaBlocks(input as any)
    expect(out[0]).toEqual({ type: 'text', text: 'hello' })
    expect(out[1]).toEqual({ type: 'thinking', text: 'hmm' })
    expect(out[2]).toMatchObject({ type: 'tool_use', id: 'tu1', name: 'Read', status: 'running' })
  })
})

describe('extractToolResults', () => {
  it('从 user message content 提取 tool_result', () => {
    const input = [
      { type: 'tool_result', tool_use_id: 'tu1', content: '内容', is_error: false },
      { type: 'tool_result', tool_use_id: 'tu2', content: [{ type: 'text', text: '块内容' }], is_error: true },
    ]
    const out = extractToolResults(input as any)
    expect(out).toEqual([
      { toolUseId: 'tu1', content: '内容', isError: false },
      { toolUseId: 'tu2', content: '块内容', isError: true },
    ])
  })
})

describe('mkNotice', () => {
  it('构造带 id 的 notice', () => {
    const n = mkNotice('status', '运行中', 'info')
    expect(n.kind).toBe('status')
    expect(n.text).toBe('运行中')
    expect(n.level).toBe('info')
    expect(typeof n.id).toBe('string')
  })
})

describe('extractBackgroundTaskId', () => {
  it('从顶层字段提取 backgroundTaskId', () => {
    const block = { type: 'tool_result', tool_use_id: 'tu1', backgroundTaskId: 'bg_abc123', content: 'ok' }
    expect(extractBackgroundTaskId(block)).toBe('bg_abc123')
  })

  it('从 structuredContent 提取', () => {
    const block = { type: 'tool_result', tool_use_id: 'tu1', structuredContent: { backgroundTaskId: 'bg_def456' }, content: 'ok' }
    expect(extractBackgroundTaskId(block)).toBe('bg_def456')
  })

  it('从 content 文本 JSON 提取', () => {
    const block = { type: 'tool_result', tool_use_id: 'tu1', content: [{ type: 'text', text: '{"backgroundTaskId":"bg_ghi789"}' }] }
    expect(extractBackgroundTaskId(block)).toBe('bg_ghi789')
  })

  it('无 backgroundTaskId 返回 undefined', () => {
    const block = { type: 'tool_result', tool_use_id: 'tu1', content: 'just some output' }
    expect(extractBackgroundTaskId(block)).toBeUndefined()
  })

  it('null block 返回 undefined', () => {
    expect(extractBackgroundTaskId(null)).toBeUndefined()
    expect(extractBackgroundTaskId(undefined)).toBeUndefined()
  })
})
