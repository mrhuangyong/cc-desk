import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { renderBlocks } from '../src/renderer/components/blocks/BlockRenderer'
import { SubagentInlineCard } from '../src/renderer/components/blocks/SubagentInlineCard'
import type { ContentBlock } from '../src/renderer/types'

// MarkdownRenderer 直通文本（避免 remark 解析干扰断言）
vi.mock('../src/renderer/components/markdown/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ text }: { text: string }) => <div>{text}</div>,
}))

// SubagentInlineCard 渲染：Task 工具在对话流的三要素组合卡片。
// 运行中的 subagent 仍在悬浮面板（hiddenToolUseIds 命中 → 不渲染）；
// 完成后解除隐藏，渲染为内嵌卡片（创建指令 + 执行过程 + 最终结果）。
//
// 注：jsdom 的 <details> 不会因 click/toggle 自动翻转 open 属性，
// 内容（折叠体内）的展开行为与 ToolUseCard 一致（已验证可点开），故这里主要验证
// 折叠态头部 + 分组边界 + 隐藏逻辑；内容三要素由组件级测试覆盖。
describe('renderBlocks: Task(subagent) 内嵌卡片', () => {
  const taskBlock: ContentBlock = {
    type: 'tool_use', id: 'toolu_sub1', name: 'Task',
    input: { description: '审查代码', subagent_type: 'general-purpose', prompt: '请审查 src' },
    status: 'completed',
    result: { content: '审查完成，发现 2 个问题', isError: false },
  }
  const bashBlock: ContentBlock = {
    type: 'tool_use', id: 'toolu_bash1', name: 'Bash',
    input: { command: 'ls' }, status: 'completed',
  }
  const processBlocks: ContentBlock[] = [
    { type: 'text', text: '开始审查' },
    { type: 'tool_use', id: 'toolu_inner1', name: 'Read', input: { file_path: 'a.ts' }, status: 'completed' },
  ]

  it('hiddenToolUseIds 命中的 Task（运行中）→ 不渲染', () => {
    const { container } = render(<>{renderBlocks([taskBlock], false, {}, new Set(['toolu_sub1']))}</>)
    // 运行中的 subagent 仍在悬浮面板，对话流不渲染卡片
    expect(container.querySelector('details')).toBeNull()
    expect(container.textContent).not.toContain('审查代码')
  })

  it('已完成的 Task（不在隐藏集）→ 渲染为内嵌卡片，折叠态头部含 description', () => {
    const { container } = render(<>{renderBlocks([taskBlock], false, { toolu_sub1: processBlocks })}</>)
    expect(container.querySelector('details')).toBeTruthy()
    // 折叠态：头部摘要应含 description
    expect(container.textContent).toContain('审查代码')
  })

  it('非隐藏的普通工具卡片 → 正常渲染（不受 Task 逻辑影响）', () => {
    const { container } = render(<>{renderBlocks([bashBlock], false, {}, new Set(['toolu_sub1']))}</>)
    expect(container.textContent).toContain('Bash')
  })

  it('Task 与普通工具相邻 → Task 作为分组边界，两者各自独立渲染', () => {
    // 两条相邻 tool_use，其中一条是 Task：Task 不应被聚进普通工具的 ToolGroup
    const { container } = render(<>{renderBlocks([bashBlock, taskBlock], false, { toolu_sub1: processBlocks })}</>)
    const text = container.textContent ?? ''
    // 普通工具仍在
    expect(text).toContain('Bash')
    // Task 内嵌卡片仍在（头部 description）
    expect(text).toContain('审查代码')
    // 应有至少两个 details：一个普通工具卡，一个 subagent 内嵌卡
    expect(container.querySelectorAll('details').length).toBeGreaterThanOrEqual(2)
  })
})

// 直接测试 SubagentInlineCard 组件（不经过 renderBlocks），覆盖三要素组合 + 边界。
// 强制 open 通过 props.defaultOpen，绕开 jsdom 不翻转 details 的限制。
describe('SubagentInlineCard 组件', () => {
  it('含 prompt + output + result → 展开后三要素齐全', () => {
    const block = {
      type: 'tool_use', id: 't1', name: 'Task',
      input: { description: '调研', prompt: '请调研 X 库' },
      status: 'completed',
      result: { content: 'X 库适合', isError: false },
    } as any
    const output: ContentBlock[] = [{ type: 'text', text: '阅读文档' }]
    const { container } = render(<SubagentInlineCard block={block} output={output} defaultOpen />)
    const text = container.textContent ?? ''
    expect(text).toContain('请调研 X 库')   // 创建指令
    expect(text).toContain('阅读文档')        // 执行过程
    expect(text).toContain('X 库适合')        // 最终结果
  })

  it('无 output → 过程区显示占位提示', () => {
    const block = {
      type: 'tool_use', id: 't2', name: 'Task',
      input: { description: 'D', prompt: 'P' }, status: 'completed',
    } as any
    const { container } = render(<SubagentInlineCard block={block} output={[]} defaultOpen />)
    expect(container.textContent).toContain('执行过程')
  })

  it('running 状态 → 头部状态点为 running 色，注入 pulse 动画', () => {
    const block = { type: 'tool_use', id: 't3', name: 'Task', input: { description: 'R' }, status: 'running' } as any
    const { container } = render(<SubagentInlineCard block={block} output={[]} />)
    expect(container.querySelector('style')).toBeTruthy() // pulse keyframes
    expect(container.textContent).toContain('R')
  })
})
