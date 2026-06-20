import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MetaToolCard } from '../src/renderer/components/blocks/MetaToolCard'

vi.mock('../src/renderer/components/markdown/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ text }: { text: string }) => <div>{text}</div>,
}))
vi.mock('../src/renderer/components/PlanDrawer', () => ({
  PlanDrawer: ({ open }: { open: boolean }) => open ? <div data-testid="plan-drawer" /> : null,
}))

describe('MetaToolCard ExitPlanMode 计划入口', () => {
  it('有 input.planFilePath 时始终显示「查看计划」按钮（不依赖展开）', () => {
    const { container } = render(
      <MetaToolCard block={{
        type: 'tool_use', id: 'p1', name: 'ExitPlanMode',
        input: { plan: '# 计划', planFilePath: '/x/plan.md' },
        status: 'completed',
        result: { content: 'Exit plan mode?', isError: true },
      } as any} />
    )
    expect(screen.getByText('查看计划')).toBeTruthy()
  })

  it('仅 input.plan（无 filePath）也显示「查看计划」按钮', () => {
    render(
      <MetaToolCard block={{
        type: 'tool_use', id: 'p2', name: 'ExitPlanMode',
        input: { plan: '# 计划' }, status: 'completed',
      } as any} />
    )
    expect(screen.getByText('查看计划')).toBeTruthy()
  })

  it('点击「查看计划」打开 PlanDrawer', () => {
    render(
      <MetaToolCard block={{
        type: 'tool_use', id: 'p3', name: 'ExitPlanMode',
        input: { plan: '# 计划', planFilePath: '/x/plan.md' }, status: 'completed',
      } as any} />
    )
    expect(screen.queryByTestId('plan-drawer')).toBeNull()
    fireEvent.click(screen.getByText('查看计划'))
    expect(screen.getByTestId('plan-drawer')).toBeTruthy()
  })

  it('折叠状态下点击「查看计划」仍能打开 PlanDrawer', () => {
    render(
      <MetaToolCard block={{
        type: 'tool_use', id: 'p5', name: 'ExitPlanMode',
        input: { plan: '# 计划', planFilePath: '/x/plan.md' }, status: 'completed',
      } as any} />
    )
    // 先折叠（ExitPlanMode 默认展开，点 summary 收起）
    const details = document.querySelector('details') as HTMLDetailsElement
    // 模拟折叠：手动改 open 并触发 onToggle 回调（组件靠 onToggle 同步 state）
    details.open = false
    details.dispatchEvent(new Event('toggle', { bubbles: true }))
    expect(details.open).toBe(false)
    // 折叠状态下点击「查看计划」应仍能打开抽屉
    expect(screen.queryByTestId('plan-drawer')).toBeNull()
    fireEvent.click(screen.getByText('查看计划'))
    expect(screen.getByTestId('plan-drawer')).toBeTruthy()
  })

  it('ExitPlanMode 不渲染无意义的占位 result（"Exit plan mode?"）', () => {
    const { container } = render(
      <MetaToolCard block={{
        type: 'tool_use', id: 'p4', name: 'ExitPlanMode',
        input: { plan: '# 计划', planFilePath: '/x/plan.md' },
        status: 'completed',
        result: { content: 'Exit plan mode?', isError: true },
      } as any} />
    )
    // ExitPlanMode 默认展开，但结果区不应出现占位文本
    expect(screen.queryByText('Exit plan mode?')).toBeNull()
  })
})
