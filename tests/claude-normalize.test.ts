import { describe, it, expect } from 'vitest'
import { normalizeBetaBlocks, extractToolResults, extractBackgroundTaskId, extractPlanFilePath, mkNotice } from '../src/main/claude-normalize'

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

  it('从 content 对象（BashOutput）提取 backgroundTaskId', () => {
    // SDK 将 Bash 工具的返回值直接作为 tool_result.content，BashOutput 对象含 backgroundTaskId
    const block = {
      type: 'tool_result', tool_use_id: 'tu1',
      content: { stdout: 'Command running in background with ID: bl6xbce7r', stderr: '', backgroundTaskId: 'bl6xbce7r', interrupted: false },
    }
    expect(extractBackgroundTaskId(block)).toBe('bl6xbce7r')
  })

  it('从 content 文本 JSON 提取', () => {
    const block = { type: 'tool_result', tool_use_id: 'tu1', content: [{ type: 'text', text: '{"backgroundTaskId":"bg_ghi789"}' }] }
    expect(extractBackgroundTaskId(block)).toBe('bg_ghi789')
  })

  it('从 Bash 后台命令的人类可读文本提取 ID（SDK 0.3.178 主路径）', () => {
    const block = {
      type: 'tool_result', tool_use_id: 'tu1',
      content: 'Command running in background with ID: bsm94mjx1. Output is being written to: /tmp/x.output',
    }
    expect(extractBackgroundTaskId(block)).toBe('bsm94mjx1')
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

describe('extractPlanFilePath', () => {
  it('从 toolUseResult.filePath 提取（真实 SDK 主路径）', () => {
    const block = {
      type: 'tool_result', tool_use_id: 'tu1',
      content: 'File created successfully at: /Users/x/.cc-desk/claude/plans/foo.md',
      toolUseResult: { type: 'create', filePath: '/Users/x/.cc-desk/claude/plans/foo.md' },
    }
    expect(extractPlanFilePath(block)).toBe('/Users/x/.cc-desk/claude/plans/foo.md')
  })

  it('从 content 文本的 "File created successfully at: <path>" 提取（toolUseResult 缺失时兜底）', () => {
    const block = {
      type: 'tool_result', tool_use_id: 'tu1',
      content: 'File updated successfully at: /Users/x/.cc-desk/claude/plans/bar.md (file state is current)',
    }
    expect(extractPlanFilePath(block)).toBe('/Users/x/.cc-desk/claude/plans/bar.md')
  })

  it('从 structuredContent.filePath 提取', () => {
    const block = { type: 'tool_result', tool_use_id: 'tu1', structuredContent: { filePath: '/Users/x/.claude/plans/foo.md' }, content: 'ok' }
    expect(extractPlanFilePath(block)).toBe('/Users/x/.claude/plans/foo.md')
  })

  it('从 content 对象的 filePath 提取', () => {
    const block = { type: 'tool_result', tool_use_id: 'tu1', content: { plan: '...', filePath: '/Users/x/.claude/plans/bar.md' } }
    expect(extractPlanFilePath(block)).toBe('/Users/x/.claude/plans/bar.md')
  })

  it('从 content 文本里的 JSON 提取 filePath', () => {
    const block = { type: 'tool_result', tool_use_id: 'tu1', content: [{ type: 'text', text: '{"filePath":"/Users/x/.claude/plans/baz.md"}' }] }
    expect(extractPlanFilePath(block)).toBe('/Users/x/.claude/plans/baz.md')
  })

  it('无 filePath 返回 undefined', () => {
    const block = { type: 'tool_result', tool_use_id: 'tu1', content: 'plan approved' }
    expect(extractPlanFilePath(block)).toBeUndefined()
  })

  it('null block 返回 undefined', () => {
    expect(extractPlanFilePath(null)).toBeUndefined()
    expect(extractPlanFilePath(undefined)).toBeUndefined()
  })
})
