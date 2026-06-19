import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'

// mock store：BlockRenderer 读 settings.showThinking
vi.mock('../src/renderer/state/store', () => ({
  useStore: () => ({ state: { settings: { showThinking: true } } }),
}))

import { renderBlocks } from '../src/renderer/components/blocks/BlockRenderer'
import { ToolGroup } from '../src/renderer/components/blocks/ToolGroup'
import type { ContentBlock } from '../src/renderer/types'

const mkTool = (id: string, name: string, status: ContentBlock extends infer T ? any : never = 'completed'): ContentBlock => ({
  type: 'tool_use', id, name, input: { x: 1 }, status,
})
const text = (t: string): ContentBlock => ({ type: 'text', text: t })

describe('renderBlocks 分组', () => {
  it('单个 tool_use 不分组，直接渲染 ToolUseCard', () => {
    const nodes = renderBlocks([text('hi'), mkTool('t1', 'Bash'), text('bye')])
    // ToolGroup 只在 ≥2 连续工具时出现；这里应无 ToolGroup
    const { container } = render(<>{nodes}</>)
    expect(container.textContent).toContain('Bash')
    expect(container.textContent).not.toContain('个工具调用')
  })

  it('连续 2+ tool_use 聚合成 ToolGroup', () => {
    const nodes = renderBlocks([mkTool('t1', 'Read'), mkTool('t2', 'Edit'), mkTool('t3', 'Write')])
    const { container } = render(<>{nodes}</>)
    expect(container.textContent).toContain('3 个工具调用')
  })

  it('文本打断连续工具，分两组', () => {
    const nodes = renderBlocks([
      mkTool('t1', 'Read'), mkTool('t2', 'Edit'),
      text('中间文本'),
      mkTool('t3', 'Write'),
    ])
    const { container } = render(<>{nodes}</>)
    // 前两个成组，后一个单独
    expect(container.textContent).toContain('2 个工具调用')
    expect(container.textContent).toContain('中间文本')
  })

  it('tool_result 夹在中间不影响分组聚合', () => {
    const result: ContentBlock = { type: 'tool_result', toolUseId: 't1', content: 'done', isError: false }
    const nodes = renderBlocks([mkTool('t1', 'Read'), result, mkTool('t2', 'Edit')])
    const { container } = render(<>{nodes}</>)
    expect(container.textContent).toContain('2 个工具调用')
  })
})

describe('ToolGroup 组件', () => {
  it('默认折叠，点击展开后显示各工具', () => {
    const tools = [mkTool('t1', 'Bash'), mkTool('t2', 'Read')] as any
    render(<ToolGroup tools={tools} />)
    // 折叠态：显示组 header，不显示单个工具名（Bash/Read 在 header 摘要里）
    const header = screen.getByText('2 个工具调用')
    expect(header).toBeTruthy()
    // 展开
    fireEvent.click(header)
    // 展开后各 ToolUseCard 的工具名出现
    expect(screen.getAllByText('Bash').length).toBeGreaterThan(0)
  })

  it('整体状态：含 running 显示进行中色', () => {
    const tools = [
      { type: 'tool_use', id: 't1', name: 'Bash', input: {}, status: 'completed' },
      { type: 'tool_use', id: 't2', name: 'Read', input: {}, status: 'running' },
    ] as any
    const { container } = render(<ToolGroup tools={tools} />)
    const dot = container.querySelector('button span[aria-hidden]') as HTMLElement
    expect(dot.style.background).toMatch(/warn|d97706/i)
  })

  it('整体状态：含 error 显示错误色', () => {
    const tools = [
      { type: 'tool_use', id: 't1', name: 'Bash', input: {}, status: 'completed' },
      { type: 'tool_use', id: 't2', name: 'Read', input: {}, status: 'error' },
    ] as any
    const { container } = render(<ToolGroup tools={tools} />)
    const dot = container.querySelector('button span[aria-hidden]') as HTMLElement
    expect(dot.style.background).toMatch(/danger/i)
  })


})
