import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BackendTaskPanel } from '../src/renderer/components/BackendTaskPanel'

describe('BackendTaskPanel', () => {
  const dispatch = vi.fn()

  beforeEach(() => { dispatch.mockClear() })

  it('两张 Card 都空 → 不渲染', () => {
    const { container } = render(<BackendTaskPanel tasks={[]} backendTasks={[]}
      showTodo showBackendTask folded={{ root: false, taskCard: false, subagentCard: false, backendTaskCard: false }}
      activeSessionId="s1" dispatch={dispatch} />)
    expect(container.firstChild).toBeNull()
  })

  it('仅 TaskCard 有内容 → 渲染 TaskCard', () => {
    render(<BackendTaskPanel
      tasks={[{ id: 't1', description: '任务A', taskType: '', status: 'running' }]}
      backendTasks={[]} showTodo showBackendTask
      folded={{ root: false, taskCard: false, subagentCard: false, backendTaskCard: false }}
      activeSessionId="s1" dispatch={dispatch} />)
    expect(screen.getByText('任务')).toBeTruthy()
  })

  it('仅 BackendTaskCard 有内容 → 渲染 BackendTaskCard', () => {
    render(<BackendTaskPanel tasks={[]}
      backendTasks={[{ id: 'b1', localSessionId: 's1', command: 'pnpm dev', kind: 'workflow', status: 'running', startedAt: Date.now(), lastKnownAt: Date.now() }]}
      showTodo showBackendTask folded={{ root: false, taskCard: false, subagentCard: false, backendTaskCard: false }}
      activeSessionId="s1" dispatch={dispatch} />)
    expect(screen.getByText('后台任务')).toBeTruthy()
    expect(screen.getByText('pnpm dev')).toBeTruthy()
  })

  it('点击 Card 标题切换折叠（dispatch SET_PANEL_FOLD）', () => {
    render(<BackendTaskPanel tasks={[]}
      backendTasks={[{ id: 'b1', localSessionId: 's1', command: 'pnpm dev', kind: 'workflow', status: 'running', startedAt: 0, lastKnownAt: 0 }]}
      showTodo showBackendTask folded={{ root: false, taskCard: false, subagentCard: false, backendTaskCard: false }}
      activeSessionId="s1" dispatch={dispatch} />)
    fireEvent.click(screen.getByText('后台任务'))
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_PANEL_FOLD', panel: 'backendTaskCard', folded: true })
    )
  })

  it('root 折叠态 → 只显示图标入口按钮，不显示 Card 内容', () => {
    render(<BackendTaskPanel
      tasks={[{ id: 't1', description: '任务A', taskType: '', status: 'running' }]}
      backendTasks={[]} showTodo showBackendTask
      folded={{ root: true, taskCard: false, subagentCard: false, backendTaskCard: false }}
      activeSessionId="s1" dispatch={dispatch} />)
    expect(screen.getByLabelText('展开面板')).toBeTruthy()
    expect(screen.queryByText('任务')).toBeNull()
  })

  it('running 任务显示终止按钮', () => {
    render(<BackendTaskPanel tasks={[]}
      backendTasks={[{ id: 'b1', localSessionId: 's1', command: 'pnpm dev', kind: 'workflow', status: 'running', startedAt: 0, lastKnownAt: 0 }]}
      showTodo showBackendTask folded={{ root: false, taskCard: false, subagentCard: false, backendTaskCard: false }}
      activeSessionId="s1" dispatch={dispatch} />)
    expect(screen.getByTitle('终止')).toBeTruthy()
  })

  it('completed 任务显示移除按钮（×）', () => {
    render(<BackendTaskPanel tasks={[]}
      backendTasks={[{ id: 'b2', localSessionId: 's1', command: 'done', kind: 'workflow', status: 'completed', startedAt: 0, lastKnownAt: 0 }]}
      showTodo showBackendTask folded={{ root: false, taskCard: false, subagentCard: false, backendTaskCard: false }}
      activeSessionId="s1" dispatch={dispatch} />)
    expect(screen.queryByTitle('终止')).toBeNull()
    expect(screen.getByTitle('移除')).toBeTruthy()
  })

  it('点击移除按钮 dispatch REMOVE_BACKEND_TASK', () => {
    render(<BackendTaskPanel tasks={[]}
      backendTasks={[{ id: 'b2', localSessionId: 's1', command: 'done', kind: 'workflow', status: 'completed', startedAt: 0, lastKnownAt: 0 }]}
      showTodo showBackendTask folded={{ root: false, taskCard: false, subagentCard: false, backendTaskCard: false }}
      activeSessionId="s1" dispatch={dispatch} />)
    fireEvent.click(screen.getByTitle('移除'))
    expect(dispatch).toHaveBeenCalledWith({ type: 'REMOVE_BACKEND_TASK', sessionId: 's1', taskId: 'b2' })
  })

  it('有已结束任务时显示清除按钮，点击 dispatch CLEAR_FINISHED_BACKEND_TASKS', () => {
    render(<BackendTaskPanel tasks={[]}
      backendTasks={[{ id: 'b2', localSessionId: 's1', command: 'done', kind: 'workflow', status: 'completed', startedAt: 0, lastKnownAt: 0 }]}
      showTodo showBackendTask folded={{ root: false, taskCard: false, subagentCard: false, backendTaskCard: false }}
      activeSessionId="s1" dispatch={dispatch} />)
    fireEvent.click(screen.getByTitle('清除已结束'))
    expect(dispatch).toHaveBeenCalledWith({ type: 'CLEAR_FINISHED_BACKEND_TASKS', sessionId: 's1' })
  })

  it('只有 running 任务时不显示清除按钮', () => {
    render(<BackendTaskPanel tasks={[]}
      backendTasks={[{ id: 'b1', localSessionId: 's1', command: 'dev', kind: 'workflow', status: 'running', startedAt: 0, lastKnownAt: 0 }]}
      showTodo showBackendTask folded={{ root: false, taskCard: false, subagentCard: false, backendTaskCard: false }}
      activeSessionId="s1" dispatch={dispatch} />)
    expect(screen.queryByTitle('清除已结束')).toBeNull()
  })

  // ===== 三段式:subagent 区 =====
  it('有 subagent 任务 → 渲染子代理区(显示 Bot 标题与 subagentType)', () => {
    render(<BackendTaskPanel tasks={[]}
      backendTasks={[{ id: 'sub1', localSessionId: 's1', command: '审查 src', kind: 'subagent', subagentType: 'general-purpose', status: 'running', startedAt: 0, lastKnownAt: 0 }]}
      showTodo showBackendTask folded={{ root: false, taskCard: false, subagentCard: false, backendTaskCard: false }}
      activeSessionId="s1" dispatch={dispatch} />)
    expect(screen.getByText('子代理')).toBeTruthy()
    expect(screen.getByText('审查 src')).toBeTruthy()
    expect(screen.getByText('general-purpose')).toBeTruthy()
  })

  it('只有 workflow 后台任务 → 不渲染子代理区', () => {
    render(<BackendTaskPanel tasks={[]}
      backendTasks={[{ id: 'b1', localSessionId: 's1', command: 'pnpm dev', kind: 'workflow', status: 'running', startedAt: 0, lastKnownAt: 0 }]}
      showTodo showBackendTask folded={{ root: false, taskCard: false, subagentCard: false, backendTaskCard: false }}
      activeSessionId="s1" dispatch={dispatch} />)
    expect(screen.queryByText('子代理')).toBeNull()
    expect(screen.getByText('后台任务')).toBeTruthy()
  })

  it('subagent 与 workflow 混合 → 两区都渲染', () => {
    render(<BackendTaskPanel tasks={[]}
      backendTasks={[
        { id: 'sub1', localSessionId: 's1', command: '审查', kind: 'subagent', subagentType: 'general-purpose', status: 'running', startedAt: 0, lastKnownAt: 0 },
        { id: 'b1', localSessionId: 's1', command: 'pnpm dev', kind: 'workflow', status: 'running', startedAt: 0, lastKnownAt: 0 },
      ]}
      showTodo showBackendTask folded={{ root: false, taskCard: false, subagentCard: false, backendTaskCard: false }}
      activeSessionId="s1" dispatch={dispatch} />)
    expect(screen.getByText('子代理')).toBeTruthy()
    expect(screen.getByText('后台任务')).toBeTruthy()
  })

  it('点击子代理区标题切换折叠(dispatch SET_PANEL_FOLD subagentCard)', () => {
    render(<BackendTaskPanel tasks={[]}
      backendTasks={[{ id: 'sub1', localSessionId: 's1', command: '审查', kind: 'subagent', subagentType: 'general-purpose', status: 'running', startedAt: 0, lastKnownAt: 0 }]}
      showTodo showBackendTask folded={{ root: false, taskCard: false, subagentCard: false, backendTaskCard: false }}
      activeSessionId="s1" dispatch={dispatch} />)
    fireEvent.click(screen.getByText('子代理'))
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_PANEL_FOLD', panel: 'subagentCard', folded: true })
    )
  })


  // ===== 抽屉:点击 subagent 行弹出详情(需求2) =====
  it('点击 subagent 行 → 弹出详情抽屉(显示标题与输出)', () => {
    render(<BackendTaskPanel tasks={[]}
      backendTasks={[{ id: 'sub-d1', localSessionId: 's1', command: '审查 src', kind: 'subagent', subagentType: 'general-purpose', toolUseId: 'toolu_d1', status: 'running', startedAt: 0, lastKnownAt: 0 }]}
      showTodo showBackendTask folded={{ root: false, taskCard: false, subagentCard: false, backendTaskCard: false }}
      activeSessionId="s1"
      subagentOutputByToolUseId={{ toolu_d1: [{ type: 'text', text: '子代理的输出内容' }] }}
      dispatch={dispatch} />)
    // 初始无抽屉
    expect(screen.queryByText('子代理的输出内容')).toBeNull()
    // 点击 subagent 行(command 文本所在行)
    fireEvent.click(screen.getByText('审查 src'))
    // 抽屉出现,展示输出
    expect(screen.getByText('子代理的输出内容')).toBeTruthy()
  })

  it('抽屉关闭按钮 → 收起', () => {
    const { rerender } = render(<BackendTaskPanel tasks={[]}
      backendTasks={[{ id: 'sub-d2', localSessionId: 's1', command: '审查', kind: 'subagent', subagentType: 'general-purpose', toolUseId: 'toolu_d2', status: 'running', startedAt: 0, lastKnownAt: 0 }]}
      showTodo showBackendTask folded={{ root: false, taskCard: false, subagentCard: false, backendTaskCard: false }}
      activeSessionId="s1"
      subagentOutputByToolUseId={{ toolu_d2: [{ type: 'text', text: '输出X' }] }}
      dispatch={dispatch} />)
    fireEvent.click(screen.getByText('审查'))
    expect(screen.getByText('输出X')).toBeTruthy()
    // 点关闭
    fireEvent.click(screen.getByLabelText('关闭'))
    expect(screen.queryByText('输出X')).toBeNull()
  })

})