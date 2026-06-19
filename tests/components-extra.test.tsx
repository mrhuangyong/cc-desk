// 核心组件交互测试：PlanCard（批准/拒绝 dispatch）、ToolUseCard（状态点/折叠）、BlockRenderer（block 分发）。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// BlockRenderer 用 useStore() 读 settings.showThinking —— 必须在 import BlockRenderer 前 mock（vi.mock 自动 hoist）
vi.mock('../src/renderer/state/store', () => ({
  useStore: () => ({ state: { settings: { showThinking: true } } }),
}))
import { PlanCard } from '../src/renderer/components/PlanCard'
import { ToolUseCard } from '../src/renderer/components/blocks/ToolUseCard'
import { BlockRenderer } from '../src/renderer/components/blocks/BlockRenderer'

describe('PlanCard', () => {
  const dispatch = vi.fn()
  const pendingPlan = { reqId: 'req1', plan: '# 重构方案\n\n1. 拆分模块\n2. 加测试' }

  beforeEach(() => {
    dispatch.mockClear()
    ;(window as any).api = { claude: { dialogResponse: vi.fn() } }
  })

  it('pendingPlan 为 null → 不渲染', () => {
    const { container } = render(<PlanCard sessionId="s1" pendingPlan={null} dispatch={dispatch} />)
    expect(container.firstChild).toBeNull()
  })

  it('pendingPlan.plan 为空串 → 不渲染', () => {
    const { container } = render(<PlanCard sessionId="s1" pendingPlan={{ reqId: 'r', plan: '' }} dispatch={dispatch} />)
    expect(container.firstChild).toBeNull()
  })

  it('渲染计划 Markdown 内容', () => {
    render(<PlanCard sessionId="s1" pendingPlan={pendingPlan} dispatch={dispatch} />)
    expect(screen.getByText(/重构方案/)).toBeTruthy()
  })

  it('直接显示授权模式按钮（一步到位，无中间步骤）', () => {
    render(<PlanCard sessionId="s1" pendingPlan={pendingPlan} dispatch={dispatch} />)
    expect(screen.getByText('自动编辑')).toBeTruthy()
    expect(screen.getByText('完全访问')).toBeTruthy()
    expect(screen.getByText('再改改')).toBeTruthy()
  })

  it('选择「自动编辑」→ dialogResponse(completed, permissionMode=自动编辑) + ANSWER_DIALOG', () => {
    render(<PlanCard sessionId="s1" pendingPlan={pendingPlan} dispatch={dispatch} />)
    fireEvent.click(screen.getByText('自动编辑'))
    expect((window as any).api.claude.dialogResponse).toHaveBeenCalledWith({
      reqId: 'req1',
      result: { behavior: 'completed', result: { permissionMode: '自动编辑' } },
    })
    expect(dispatch).toHaveBeenCalledWith({ type: 'ANSWER_DIALOG' })
  })

  it('选择「完全访问」→ dialogResponse(completed, permissionMode=完全访问)', () => {
    render(<PlanCard sessionId="s1" pendingPlan={pendingPlan} dispatch={dispatch} />)
    fireEvent.click(screen.getByText('完全访问'))
    expect((window as any).api.claude.dialogResponse).toHaveBeenCalledWith({
      reqId: 'req1',
      result: { behavior: 'completed', result: { permissionMode: '完全访问' } },
    })
    expect(dispatch).toHaveBeenCalledWith({ type: 'ANSWER_DIALOG' })
  })

  it('点击「再改改」→ dialogResponse(cancelled) + ANSWER_DIALOG', () => {
    render(<PlanCard sessionId="s1" pendingPlan={pendingPlan} dispatch={dispatch} />)
    fireEvent.click(screen.getByText('再改改'))
    expect((window as any).api.claude.dialogResponse).toHaveBeenCalledWith({
      reqId: 'req1',
      result: { behavior: 'cancelled' },
    })
    expect(dispatch).toHaveBeenCalledWith({ type: 'ANSWER_DIALOG' })
  })
})

describe('ToolUseCard', () => {
  // 状态色点：running 琥珀 / error 红 / done 绿，由 CSS 渲染而非 emoji。
  // 状态点为 summary 内首个 span（圆形），取其 background 断言颜色族。
  function statusDotColor(container: HTMLElement): string {
    const summary = container.querySelector('summary')!
    const dot = summary.querySelector('span[aria-hidden]') as HTMLElement
    return dot.style.background
  }

  it('running 状态显示琥珀色点，summary 含工具名', () => {
    const { container } = render(
      <ToolUseCard block={{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' }, status: 'running' }} />,
    )
    expect(container.textContent).toContain('Bash')
    expect(statusDotColor(container)).toMatch(/d97706|amber|warn/i)
  })

  it('error 状态显示红色点', () => {
    const { container } = render(
      <ToolUseCard block={{ type: 'tool_use', id: 'tu1', name: 'Edit', input: {}, status: 'error' }} />,
    )
    expect(container.textContent).toContain('Edit')
    expect(statusDotColor(container)).toMatch(/danger|#[ec][0-9a-f]{5}|e57575/i)
  })

  it('completed 状态显示绿色点', () => {
    const { container } = render(
      <ToolUseCard block={{ type: 'tool_use', id: 'tu1', name: 'Read', input: {}, status: 'completed' }} />,
    )
    expect(container.textContent).toContain('Read')
    expect(statusDotColor(container)).toMatch(/16a34a|ok|status-ok/i)
  })

  it('默认折叠（不显示输入详情），展开后显示输入 JSON', () => {
    const { container } = render(
      <ToolUseCard block={{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'echo hi' }, status: 'completed' }} />,
    )
    // summary 总是显示
    const summary = container.querySelector('summary')!
    // 折叠态：details open=false
    expect(summary.textContent).toContain('Bash')
    // 展开
    fireEvent.click(summary)
    expect(container.textContent).toContain('echo hi')
  })
})

describe('BlockRenderer（block 分发）', () => {
  it('text 块 → TextBlock', () => {
    const { container } = render(<BlockRenderer block={{ type: 'text', text: 'hello world' }} />)
    expect(container.textContent).toContain('hello world')
  })

  it('tool_use 块 → ToolUseCard', () => {
    const { container } = render(<BlockRenderer block={{ type: 'tool_use', id: 'x', name: 'Bash', input: {}, status: 'completed' }} />)
    expect(container.textContent).toContain('Bash')
  })

  it('tool_result 块 → null', () => {
    const { container } = render(<BlockRenderer block={{ type: 'tool_result', toolUseId: 'x', content: 'r', isError: false }} />)
    expect(container.firstChild).toBeNull()
  })
})
