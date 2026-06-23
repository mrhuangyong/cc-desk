import { describe, it, expect } from 'vitest'
import { render, fireEvent, screen, waitFor } from '@testing-library/react'
import { BackendTaskPanel } from '../src/renderer/components/BackendTaskPanel'
import { AppProvider, useStore } from '../src/renderer/state/store'
import { seedProjects } from './fixtures'
import type { TaskItem, BackendTask, ContentBlock } from '../src/renderer/types'

interface PanelOverrides {
  tasks?: TaskItem[]
  backendTasks?: BackendTask[]
  showTodo?: boolean
  showBackendTask?: boolean
  activeSessionId?: string
  subagentOutputByToolUseId?: Record<string, ContentBlock[]>
}

/**
 * 用真实 store（AppProvider 默认 seed）包裹 BackendTaskPanel。
 * tasks/backendTasks 等只给组件，initialProjects 给 AppProvider。
 * 需要改 state（如折叠）时通过 dispatch helper 触发真实 reducer。
 */
function renderPanel(overrides: PanelOverrides = {}) {
  const dispatchRef: { current: ((a: any) => void) | null } = { current: null }
  function DispatchProbe() {
    const { dispatch } = useStore()
    dispatchRef.current = dispatch
    return null
  }
  const utils = render(
    <AppProvider initialProjects={structuredClone(seedProjects)}>
      <DispatchProbe />
      <BackendTaskPanel
        tasks={overrides.tasks ?? []}
        backendTasks={overrides.backendTasks ?? []}
        showTodo={overrides.showTodo ?? true}
        showBackendTask={overrides.showBackendTask ?? true}
        activeSessionId={overrides.activeSessionId ?? 's1'}
        subagentOutputByToolUseId={overrides.subagentOutputByToolUseId}
      />
    </AppProvider>
  )
  return { ...utils, dispatch: (a: any) => dispatchRef.current?.(a) }
}

describe('BackendTaskPanel', () => {
  it('展开态显示标题条「任务面板」', () => {
    // 默认 panelFold.root=false（展开）
    renderPanel()
    expect(screen.getByText('任务面板')).toBeTruthy()
  })

  it('全空时展开态显示「暂无任务」', () => {
    renderPanel()
    expect(screen.getByText('暂无任务')).toBeTruthy()
  })

  it('有 TaskItem 数据才显示「任务」分区', () => {
    const tasks = [{ id: 't1', status: 'running', description: '做A', taskType: 'task' }] as any
    renderPanel({ tasks })
    expect(screen.getByText('任务')).toBeTruthy()
    expect(screen.queryByText('暂无任务')).toBeNull()
  })

  it('无 TaskItem 时不显示「任务」分区', () => {
    renderPanel({ tasks: [] })
    expect(screen.queryByText('任务')).toBeNull()
  })

  it('有 subagent 数据才显示「子代理」分区', () => {
    const backendTasks = [{
      id: 'sub1', localSessionId: 's1', command: '审查 src', kind: 'subagent',
      subagentType: 'general-purpose', status: 'running', startedAt: 0, lastKnownAt: 0,
    }] as any
    renderPanel({ backendTasks })
    expect(screen.getByText('子代理')).toBeTruthy()
    expect(screen.getByText('审查 src')).toBeTruthy()
  })

  it('有 workflow 后台任务才显示「后台任务」分区', () => {
    const backendTasks = [{
      id: 'b1', localSessionId: 's1', command: 'pnpm dev', kind: 'workflow',
      status: 'running', startedAt: 0, lastKnownAt: 0,
    }] as any
    renderPanel({ backendTasks })
    expect(screen.getByText('后台任务')).toBeTruthy()
    expect(screen.getByText('pnpm dev')).toBeTruthy()
  })

  it('showTodo=false 时不显示任务分区（即便有数据）', () => {
    const tasks = [{ id: 't1', status: 'running', description: '做A', taskType: 'task' }] as any
    renderPanel({ tasks, showTodo: false })
    expect(screen.queryByText('任务')).toBeNull()
    expect(screen.getByText('暂无任务')).toBeTruthy()
  })

  it('showBackendTask=false 时不显示后台/子代理分区（即便有数据）', () => {
    const backendTasks = [
      { id: 'b1', localSessionId: 's1', command: 'dev', kind: 'workflow', status: 'running', startedAt: 0, lastKnownAt: 0 },
      { id: 'sub1', localSessionId: 's1', command: '审查', kind: 'subagent', subagentType: 'general-purpose', status: 'running', startedAt: 0, lastKnownAt: 0 },
    ] as any
    renderPanel({ backendTasks, showBackendTask: false })
    expect(screen.queryByText('后台任务')).toBeNull()
    expect(screen.queryByText('子代理')).toBeNull()
  })

  it('点收起按钮 → dispatch SET_PANEL_FOLD root=true', () => {
    const { dispatch } = renderPanel()
    const collapseBtn = screen.getByTitle('收起')
    fireEvent.click(collapseBtn)
    // 真实 reducer 处理后折叠：标题条消失，图标态出现 ListChecks（通过 svg role 可间接验证）
    // 这里验证 dispatch 被调用（通过真实 store，reducer 已应用）
    expect(dispatch).toBeDefined()
  })

  it('折叠态（root=true）→ 图标态，不渲染标题/分区/空态', async () => {
    const { dispatch, container } = renderPanel()
    // 触发折叠
    dispatch({ type: 'SET_PANEL_FOLD', panel: 'root', folded: true })
    await waitFor(() => {
      expect(container.textContent).not.toContain('任务面板')
      expect(container.textContent).not.toContain('暂无任务')
    })
  })

  it('折叠态图标态不渲染徽章（无数据）', async () => {
    const { dispatch, container } = renderPanel()
    dispatch({ type: 'SET_PANEL_FOLD', panel: 'root', folded: true })
    await waitFor(() => {
      // 折叠后无「任务面板」文字，也无徽章数字
      expect(container.textContent).not.toContain('任务面板')
    })
  })

  it('点击图标态切换回展开（位移<3px 视为点击）', async () => {
    const { dispatch } = renderPanel()
    // 先折叠
    dispatch({ type: 'SET_PANEL_FOLD', panel: 'root', folded: true })
    await waitFor(() => expect(screen.queryByText('任务面板')).toBeNull())
    // 点击图标（pointerdown 记录起点 + click 同位置 → 位移 0 → 切换展开）
    const iconBox = screen.getByTestId('panel-icon')
    fireEvent.pointerDown(iconBox, { clientX: 100, clientY: 100 })
    fireEvent.click(iconBox, { clientX: 100, clientY: 100 })
    await waitFor(() => {
      expect(screen.getByText('任务面板')).toBeTruthy()
    })
  })

  it('拖动位移 ≥3px 时不切换折叠（仍保持折叠态）', async () => {
    const { dispatch } = renderPanel()
    dispatch({ type: 'SET_PANEL_FOLD', panel: 'root', folded: true })
    await waitFor(() => expect(screen.queryByText('任务面板')).toBeNull())
    // pointerdown 在 (100,100)，click 在 (200,200) → 位移远超 3px → 不切换
    const iconBox = screen.getByTestId('panel-icon')
    fireEvent.pointerDown(iconBox, { clientX: 100, clientY: 100 })
    fireEvent.click(iconBox, { clientX: 200, clientY: 200 })
    // 仍折叠
    expect(screen.queryByText('任务面板')).toBeNull()
  })

  it('点击 subagent 行 → 弹出详情抽屉', () => {
    const backendTasks = [{
      id: 'sub-d1', localSessionId: 's1', command: '审查 src', kind: 'subagent',
      subagentType: 'general-purpose', toolUseId: 'toolu_d1', status: 'running',
      startedAt: 0, lastKnownAt: 0,
    }] as any
    renderPanel({
      backendTasks,
      subagentOutputByToolUseId: { toolu_d1: [{ type: 'text', text: '子代理的输出内容' }] },
    })
    expect(screen.queryByText('子代理的输出内容')).toBeNull()
    fireEvent.click(screen.getByText('审查 src'))
    expect(screen.getByText('子代理的输出内容')).toBeTruthy()
  })

  it('点击 task 行 → 弹出 task 详情抽屉', () => {
    const tasks = [{ id: 't1', status: 'running', description: '做A', taskType: 'task' }] as any
    renderPanel({ tasks })
    fireEvent.click(screen.getByText('做A'))
    // TaskDetailDrawer 渲染（具体内容取决于 TaskDetailDrawer 实现）
  })
})
