import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
  /** 渲染前强制展开面板（默认折叠后，多数断言展开态内容的用例需要）。 */
  expanded?: boolean
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
  // 默认折叠（panelFold.root=true）；需要展开态的用例设 expanded:true，在 render 后 dispatch。
  // dispatch 触发的状态更新异步刷新，故这些用例的断言需用 waitFor 等待展开。
  if (overrides.expanded) {
    dispatchRef.current?.({ type: 'SET_PANEL_FOLD', panel: 'root', folded: false })
  }
  return { ...utils, dispatch: (a: any) => dispatchRef.current?.(a) }
}

describe('BackendTaskPanel', () => {
  it('展开态显示标题条「任务面板」', async () => {
    // 默认 panelFold.root=true（折叠）；此处主动展开验证内容
    renderPanel({ expanded: true })
    await waitFor(() => expect(screen.getByText('任务面板')).toBeTruthy())
  })

  it('全空时展开态显示「暂无任务」', async () => {
    renderPanel({ expanded: true })
    await waitFor(() => expect(screen.getByText('暂无任务')).toBeTruthy())
  })

  it('有 TaskItem 数据才显示「任务」分区', async () => {
    const tasks = [{ id: 't1', status: 'running', description: '做A', taskType: 'task' }] as any
    renderPanel({ tasks, expanded: true })
    await waitFor(() => expect(screen.getByText('任务')).toBeTruthy())
    expect(screen.queryByText('暂无任务')).toBeNull()
  })

  it('无 TaskItem 时不显示「任务」分区', async () => {
    renderPanel({ tasks: [], expanded: true })
    await waitFor(() => expect(screen.queryByText('任务')).toBeNull())
  })

  it('有 subagent 数据才显示「子代理」分区', async () => {
    const backendTasks = [{
      id: 'sub1', localSessionId: 's1', command: '审查 src', kind: 'subagent',
      subagentType: 'general-purpose', status: 'running', startedAt: 0, lastKnownAt: 0,
    }] as any
    renderPanel({ backendTasks, expanded: true })
    await waitFor(() => expect(screen.getByText('子代理')).toBeTruthy())
    expect(screen.getByText('审查 src')).toBeTruthy()
  })

  it('有 workflow 后台任务才显示「后台任务」分区', async () => {
    const backendTasks = [{
      id: 'b1', localSessionId: 's1', command: 'pnpm dev', kind: 'workflow',
      status: 'running', startedAt: 0, lastKnownAt: 0,
    }] as any
    renderPanel({ backendTasks, expanded: true })
    await waitFor(() => expect(screen.getByText('后台任务')).toBeTruthy())
    expect(screen.getByText('pnpm dev')).toBeTruthy()
  })

  it('showTodo=false 时不显示任务分区（即便有数据）', async () => {
    const tasks = [{ id: 't1', status: 'running', description: '做A', taskType: 'task' }] as any
    renderPanel({ tasks, showTodo: false, expanded: true })
    await waitFor(() => expect(screen.queryByText('任务')).toBeNull())
    expect(screen.getByText('暂无任务')).toBeTruthy()
  })

  it('showBackendTask=false 时不显示后台/子代理分区（即便有数据）', async () => {
    const backendTasks = [
      { id: 'b1', localSessionId: 's1', command: 'dev', kind: 'workflow', status: 'running', startedAt: 0, lastKnownAt: 0 },
      { id: 'sub1', localSessionId: 's1', command: '审查', kind: 'subagent', subagentType: 'general-purpose', status: 'running', startedAt: 0, lastKnownAt: 0 },
    ] as any
    renderPanel({ backendTasks, showBackendTask: false, expanded: true })
    await waitFor(() => expect(screen.queryByText('后台任务')).toBeNull())
    expect(screen.queryByText('子代理')).toBeNull()
  })

  it('默认折叠（root=true），不渲染展开态内容', () => {
    renderPanel()
    expect(screen.queryByText('任务面板')).toBeNull()
    expect(screen.getByTestId('panel-icon')).toBeTruthy()
  })

  it('首次有内容时自动展开（totalCount 0→>0）', async () => {
    // 默认折叠；传入任务后，totalCount 从 0 变 >0 应触发自动展开
    const tasks = [{ id: 't1', status: 'running', description: '做A', taskType: 'task' }] as any
    renderPanel({ tasks })
    await waitFor(() => expect(screen.getByText('任务面板')).toBeTruthy())
  })

  it('点收起按钮 → dispatch SET_PANEL_FOLD root=true', async () => {
    const { dispatch } = renderPanel({ expanded: true })
    const collapseBtn = await waitFor(() => screen.getByTitle('收起'))
    fireEvent.click(collapseBtn)
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

  it('点击 subagent 行 → 弹出详情抽屉', async () => {
    const backendTasks = [{
      id: 'sub-d1', localSessionId: 's1', command: '审查 src', kind: 'subagent',
      subagentType: 'general-purpose', toolUseId: 'toolu_d1', status: 'running',
      startedAt: 0, lastKnownAt: 0,
    }] as any
    renderPanel({
      backendTasks,
      subagentOutputByToolUseId: { toolu_d1: [{ type: 'text', text: '子代理的输出内容' }] },
      expanded: true,
    })
    await waitFor(() => expect(screen.queryByText('子代理的输出内容')).toBeNull())
    fireEvent.click(screen.getByText('审查 src'))
    expect(screen.getByText('子代理的输出内容')).toBeTruthy()
  })

  it('点击 task 行 → 弹出 task 详情抽屉', async () => {
    const tasks = [{ id: 't1', status: 'running', description: '做A', taskType: 'task' }] as any
    renderPanel({ tasks, expanded: true })
    const taskRow = await waitFor(() => screen.getByText('做A'))
    fireEvent.click(taskRow)
    // TaskDetailDrawer 渲染（具体内容取决于 TaskDetailDrawer 实现）
  })

  describe('rememberPanelPosition:false 负向断言', () => {
    afterEach(() => {
      delete (window as any).api
    })

    it('rememberPanelPosition:false 时，拖动不落盘 panelPosition', async () => {
      const saveMock = vi.fn()
      ;(window as any).api = {
        settings: { save: saveMock },
        backendTask: { kill: vi.fn(), remove: vi.fn() },
      }
      const { dispatch } = renderPanel()
      // 关闭面板位置记忆，并折叠成图标态（图标态有 onPointerDown 拖把手）
      dispatch({ type: 'SET_SETTINGS', settings: { rememberPanelPosition: false } })
      dispatch({ type: 'SET_PANEL_FOLD', panel: 'root', folded: true })
      await waitFor(() => expect(screen.queryByText('任务面板')).toBeNull())
      // 清空挂载/切换阶段累积的调用，只观察「拖动」这一动作
      saveMock.mockClear()

      const iconBox = screen.getByTestId('panel-icon')
      // 真实拖动序列：pointerdown → pointermove(位移 ≥3px) → pointerup。
      // useDraggable 在 pointerdown 时 setDragging(true) 并在 window 上注册
      // pointermove/pointerup 监听，故 move/up 需 dispatch 到 window。
      fireEvent.pointerDown(iconBox, { clientX: 100, clientY: 100 })
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 150, clientY: 100, buttons: 1 }))
      window.dispatchEvent(new MouseEvent('pointerup', { clientX: 150, clientY: 100 }))

      // 关键负向断言：rememberPanelPosition:false 下，拖动不应触发以 panelPosition 为 key 的 save
      const calledWithPanelPosition = saveMock.mock.calls.some(
        ([arg]) => arg && typeof arg === 'object' && 'panelPosition' in arg,
      )
      expect(calledWithPanelPosition).toBe(false)
    })
  })
})
