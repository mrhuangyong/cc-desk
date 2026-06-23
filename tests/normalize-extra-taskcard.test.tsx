// claude-normalize 边界补充 + TaskCard 渲染测试。
import { describe, it, expect } from 'vitest'
import { normalizeBetaBlocks, extractToolResults, extractBackgroundTaskId } from '../src/main/claude-normalize'
import { render } from '@testing-library/react'
import { TaskCard } from '../src/renderer/components/TaskPanel'
import type { TaskItem } from '../src/renderer/types'

describe('normalizeBetaBlocks 边界', () => {
  it('非数组输入（null/undefined/string/对象）返回空数组', () => {
    expect(normalizeBetaBlocks(null as any)).toEqual([])
    expect(normalizeBetaBlocks(undefined as any)).toEqual([])
    expect(normalizeBetaBlocks('string' as any)).toEqual([])
    expect(normalizeBetaBlocks({ a: 1 } as any)).toEqual([])
  })

  it('image 块：提取 source.data', () => {
    const out = normalizeBetaBlocks([{ type: 'image', source: { data: 'base64data' } }])
    expect(out[0]).toEqual({ type: 'image', source: 'base64data' })
  })

  it('image 块缺 source.data → 空串', () => {
    const out = normalizeBetaBlocks([{ type: 'image' }])
    expect(out[0]).toEqual({ type: 'image', source: '' })
  })

  it('未知 type → 降级为 text(JSON.stringify)', () => {
    const out = normalizeBetaBlocks([{ type: 'weird_type', foo: 'bar', n: 1 }])
    expect(out[0].type).toBe('text')
    const parsed = JSON.parse(out[0].text)
    expect(parsed.foo).toBe('bar')
    expect(parsed.n).toBe(1)
  })

  it('text/thinking 缺字段 → 空串兜底', () => {
    const out = normalizeBetaBlocks([{ type: 'text' }, { type: 'thinking' }])
    expect(out[0]).toEqual({ type: 'text', text: '' })
    expect(out[1]).toEqual({ type: 'thinking', text: '' })
  })

  it('tool_use 默认 status=running', () => {
    const out = normalizeBetaBlocks([{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { cmd: 'ls' } }])
    expect(out[0]).toMatchObject({ type: 'tool_use', id: 'tu1', name: 'Bash', status: 'running' })
  })

  it('混合多种 block 顺序保留', () => {
    const out = normalizeBetaBlocks([
      { type: 'text', text: 'a' },
      { type: 'tool_use', id: '1', name: 'X', input: {} },
      { type: 'image', source: { data: 'd' } },
      { type: 'thinking', text: 't' },
    ])
    expect(out.map(b => b.type)).toEqual(['text', 'tool_use', 'image', 'thinking'])
  })
})

describe('extractToolResults 边界', () => {
  it('content 为对象形态 → JSON 序列化', () => {
    const out = extractToolResults([{ type: 'tool_result', tool_use_id: 'tu1', content: { result: 'ok', code: 0 }, is_error: false }])
    expect(out[0].toolUseId).toBe('tu1')
    expect(JSON.parse(out[0].content)).toEqual({ result: 'ok', code: 0 })
    expect(out[0].isError).toBe(false)
  })

  it('content 为 null → 序列化为 ""（JSON.stringify("")）', () => {
    const out = extractToolResults([{ type: 'tool_result', tool_use_id: 'tu1', content: null }])
    expect(out[0].content).toBe('""')
  })

  it('content 缺失（undefined）→ 同样序列化', () => {
    const out = extractToolResults([{ type: 'tool_result', tool_use_id: 'tu1' }])
    expect(out[0].content).toBe('""')
  })

  it('is_error 缺失默认 false', () => {
    const out = extractToolResults([{ type: 'tool_result', tool_use_id: 'tu1', content: 'x' }])
    expect(out[0].isError).toBe(false)
  })

  it('非数组输入返回空', () => {
    expect(extractToolResults(null as any)).toEqual([])
    expect(extractToolResults(undefined as any)).toEqual([])
  })

  it('过滤非 tool_result block', () => {
    const out = extractToolResults([
      { type: 'text', text: 'noise' },
      { type: 'tool_result', tool_use_id: 'tu1', content: 'real' },
    ])
    expect(out.length).toBe(1)
  })
})

describe('extractBackgroundTaskId 补充边界', () => {
  it('空字符串 backgroundTaskId 不返回（视为无）', () => {
    expect(extractBackgroundTaskId({ backgroundTaskId: '' })).toBeUndefined()
  })
  it('content 文本含多个候选只取第一个匹配', () => {
    expect(extractBackgroundTaskId({ content: 'background with ID: task-abc-123 done' })).toBe('task-abc-123')
  })
})

describe('TaskCard 渲染', () => {
  it('空任务列表 → 不渲染', () => {
    const { container } = render(<TaskCard tasks={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('混合状态：统计 running/done/总数', () => {
    const tasks: TaskItem[] = [
      { id: 't1', description: '搜索', taskType: 'agent', status: 'running' },
      { id: 't2', description: '编译', taskType: '', status: 'running' },
      { id: 't3', description: '测试', taskType: '', status: 'completed' },
      { id: 't4', description: '部署', taskType: '', status: 'failed' },
    ]
    const { container } = render(<TaskCard tasks={tasks} />)
    expect(container.textContent).toContain('2 进行')
    expect(container.textContent).toContain('1 完成')
    expect(container.textContent).toContain('共 4')
  })

  it('渲染每个任务的描述与状态标签', () => {
    const tasks: TaskItem[] = [
      { id: 't1', description: '任务A', taskType: 'agent', status: 'completed' },
      { id: 't2', description: '', taskType: '', status: 'paused' },
    ]
    const { container } = render(<TaskCard tasks={tasks} />)
    expect(container.textContent).toContain('任务A')
    expect(container.textContent).toContain('已完成')   // STATUS_LABEL[completed]
    expect(container.textContent).toContain('已暂停')   // STATUS_LABEL[paused]
    expect(container.textContent).toContain('agent')   // taskType
    // 空描述 → 占位
    expect(container.textContent).toContain('(无描述)')
  })
})
