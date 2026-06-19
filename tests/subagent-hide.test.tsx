import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { renderBlocks } from '../src/renderer/components/blocks/BlockRenderer'
import type { ContentBlock } from '../src/renderer/types'

describe('renderBlocks: subagent Task 卡片主流隐藏', () => {
  const taskBlock: ContentBlock = {
    type: 'tool_use', id: 'toolu_sub1', name: 'Task',
    input: { description: '审查' }, status: 'running',
  }
  const bashBlock: ContentBlock = {
    type: 'tool_use', id: 'toolu_bash1', name: 'Bash',
    input: { command: 'ls' }, status: 'completed',
  }

  it('hiddenToolUseIds 命中的 Task 卡片 → 不渲染', () => {
    const { container } = render(<>{renderBlocks([taskBlock], false, {}, new Set(['toolu_sub1']))}</>)
    // 该 Task 卡片不应出现在 DOM
    expect(container.textContent).not.toContain('Task')
    expect(container.querySelector('details')).toBeNull()
  })

  it('非隐藏的普通工具卡片 → 正常渲染', () => {
    const { container } = render(<>{renderBlocks([bashBlock], false, {}, new Set(['toolu_sub1']))}</>)
    expect(container.textContent).toContain('Bash')
  })

  it('不传 hiddenToolUseIds → Task 卡片正常渲染(向后兼容)', () => {
    const { container } = render(<>{renderBlocks([taskBlock])}</>)
    expect(container.textContent).toContain('Task')
  })

  it('分组中混入 subagent 卡片 → 仅隐藏 subagent,保留其余', () => {
    // 两条 tool_use 触发分组(group.length>=2),其中一条是 subagent
    const { container } = render(<>{renderBlocks([taskBlock, bashBlock], false, {}, new Set(['toolu_sub1']))}</>)
    expect(container.textContent).toContain('Bash')
    expect(container.textContent).not.toContain('审查')
  })
})
