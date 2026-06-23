// ChatArea 测试：extractText 纯函数、CopyButton 交互、IPC 监听→dispatch 链路、消息渲染分支。
// ChatArea 整组件依赖大量子组件（含 TipTap 的 InputBar），故将子组件 stub 为简单 div，
// 聚焦测 ChatArea 本体职责：IPC 监听注册与 dispatch、消息列表渲染、空会话态。
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// ---- mock store ----
let mockState: any
const dispatch = vi.fn()
vi.mock('../src/renderer/state/store', () => ({
  useStore: () => ({ state: mockState, dispatch }),
}))
// ---- mock i18n（ChatArea 用 useI18n）----
vi.mock('../src/renderer/i18n/useI18n', () => ({
  useI18n: () => ({ t: (k: string) => k, lang: 'zh-CN' }),
}))
// ---- stub 子组件（避免 InputBar 的 TipTap 等重依赖）----
vi.mock('../src/renderer/components/InputBar', () => ({
  InputBar: () => <div data-testid="inputbar-stub" />,
}))
vi.mock('../src/renderer/components/InputDock', () => ({
  InputDock: ({ children }: any) => <div data-testid="inputdock-stub">{children}</div>,
}))
vi.mock('../src/renderer/components/Notices', () => ({
  Notices: () => <div data-testid="notices-stub" />,
}))
vi.mock('../src/renderer/components/BackendTaskPanel', () => ({
  BackendTaskPanel: () => <div data-testid="btp-stub" />,
}))
vi.mock('../src/renderer/components/PlanCard', () => ({
  PlanCard: () => <div data-testid="plan-stub" />,
}))
vi.mock('../src/renderer/components/AttachmentChip', () => ({
  AttachmentChip: () => <div data-testid="chip-stub" />,
}))
// BlockRenderer 不 stub——它真实渲染文本/tool_use（依赖 useStore，已 mock）

import { extractText, CopyButton } from '../src/renderer/components/ChatArea'
import { ChatArea } from '../src/renderer/components/ChatArea'
import type { ContentBlock } from '../src/renderer/types'

// jsdom 不实现 scrollTo/scrollIntoView；ChatArea 的 effect 会调用，需 polyfill
beforeAll(() => {
  if (!window.HTMLElement.prototype.scrollTo) {
    window.HTMLElement.prototype.scrollTo = () => {}
  }
  if (!window.HTMLElement.prototype.scrollIntoView) {
    window.HTMLElement.prototype.scrollIntoView = () => {}
  }
})

describe('extractText（纯函数）', () => {
  it('text block → 原文', () => {
    expect(extractText([{ type: 'text', text: 'hello' }])).toBe('hello')
  })
  it('thinking block → (思考) 前缀', () => {
    expect(extractText([{ type: 'thinking', text: '分析中' }])).toBe('(思考) 分析中')
  })
  it('tool_use block → 🔧 工具名(input) + 结果', () => {
    const out = extractText([{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { cmd: 'ls' }, status: 'completed', result: { content: 'OK', isError: false } }])
    expect(out).toContain('🔧 Bash')
    expect(out).toContain('ls')
    expect(out).toContain('结果：OK')
  })
  it('tool_use 无结果时不追加「结果：」', () => {
    const out = extractText([{ type: 'tool_use', id: 'tu1', name: 'Read', input: {}, status: 'running' }])
    expect(out).not.toContain('结果：')
  })
  it('多 block 用换行连接 + trim', () => {
    const out = extractText([
      { type: 'text', text: '第一行' },
      { type: 'text', text: '第二行' },
    ])
    expect(out).toBe('第一行\n第二行')
  })
  it('未知 block 类型贡献空串', () => {
    expect(extractText([{ type: 'image', source: 'x' } as any])).toBe('')
  })
})

describe('CopyButton', () => {
  beforeEach(() => {
    ;(navigator as any).clipboard = { writeText: vi.fn().mockResolvedValue(undefined) }
  })

  it('点击调用 clipboard.writeText（复制到剪贴板）', () => {
    const { container } = render(<CopyButton text="copy me" />)
    const btn = screen.getByLabelText('复制')
    fireEvent.click(btn)
    expect((navigator as any).clipboard.writeText).toHaveBeenCalledWith('copy me')
    // 初始渲染为 Copy 图标（未复制态）
    expect(container.querySelectorAll('svg').length).toBeGreaterThan(0)
  })
})

describe('ChatArea IPC 监听 → dispatch 链路', () => {
  // 捕获各 on* 注册的回调
  let handlers: Record<string, (data: any) => void>
  const unsubBackend = vi.fn()

  beforeEach(() => {
    dispatch.mockClear()
    handlers = {}
    ;(window as any).api = {
      claude: {
        onSystem: (cb: any) => { handlers.onSystem = cb },
        onDelta: (cb: any) => { handlers.onDelta = cb },
        onBlocks: (cb: any) => { handlers.onBlocks = cb },
        onNotice: (cb: any) => { handlers.onNotice = cb },
        onTask: (cb: any) => { handlers.onTask = cb },
        onResult: (cb: any) => { handlers.onResult = cb },
        onError: (cb: any) => { handlers.onError = cb },
        onAborted: (cb: any) => { handlers.onAborted = cb },
        onDialogRequest: (cb: any) => { handlers.onDialogRequest = cb },
        onNotification: (cb: any) => { handlers.onNotification = cb },
        onSubagentOutput: (cb: any) => { handlers.onSubagentOutput = cb },
        removeAllListeners: vi.fn(),
      },
      backendTask: { onEvent: () => unsubBackend },
    }
    mockState = baseState()
  })

  function baseState() {
    return {
      activeSessionId: 's1',
      projects: [{ id: 'p1', name: 'proj', sessions: [{ id: 's1', title: '会话1', messages: [] }] }],
      settings: { showTodo: false, showBackendTask: false, taskNotify: false, notifySound: false },
      tasksBySession: {}, backendTasksBySession: {}, subagentOutputBySession: {}, planBySession: {},
      streamingBySession: {},
      panelFold: { root: false }, panelPosition: { x: 0, y: 0 },
    }
  }

  it('onSystem 收到 sessionId → SET_CLAUDE_SESSION_ID', () => {
    render(<ChatArea />)
    handlers.onSystem({ localSessionId: 's1', sessionId: 'c-claude-1', model: 'm', tools: [] })
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_CLAUDE_SESSION_ID', localSessionId: 's1', claudeSessionId: 'c-claude-1' })
  })

  it('onDelta → STREAM_DELTA', () => {
    render(<ChatArea />)
    handlers.onDelta({ localSessionId: 's1', kind: 'text', delta: 'hi' })
    expect(dispatch).toHaveBeenCalledWith({ type: 'STREAM_DELTA', sessionId: 's1', kind: 'text', delta: 'hi' })
  })

  it('onBlocks assistant_blocks → STREAM_ASSISTANT_BLOCKS', () => {
    render(<ChatArea />)
    handlers.onBlocks({ localSessionId: 's1', op: 'assistant_blocks', blocks: [], uuid: 'u1' })
    expect(dispatch).toHaveBeenCalledWith({ type: 'STREAM_ASSISTANT_BLOCKS', sessionId: 's1', blocks: [], uuid: 'u1' })
  })

  it('onTask started → UPSERT_TASK', () => {
    render(<ChatArea />)
    handlers.onTask({ localSessionId: 's1', kind: 'started', taskId: 't1', description: '搜索', taskType: 'agent' })
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'UPSERT_TASK', sessionId: 's1' }))
  })

  it('onTask todo_sync → SET_TASKS（TodoWrite 待办列表映射成任务）', () => {
    render(<ChatArea />)
    handlers.onTask({
      localSessionId: 's1', kind: 'todo_sync',
      todos: [
        { content: '读取文件', status: 'completed' },
        { content: '修改代码', status: 'in_progress' },
        { content: '跑测试', status: 'pending' },
      ],
    })
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_TASKS', sessionId: 's1' }))
    const call = dispatch.mock.calls.find((c: any[]) => c[0]?.type === 'SET_TASKS')
    expect(call).toBeTruthy()
    const tasks = call![0].tasks
    expect(tasks).toHaveLength(3)
    expect(tasks[0]).toMatchObject({ description: '读取文件', status: 'completed', taskType: 'todo' })
    expect(tasks[1]).toMatchObject({ description: '修改代码', status: 'running' })
    expect(tasks[2]).toMatchObject({ description: '跑测试', status: 'pending' })
  })

  it('onResult → STREAM_END', () => {
    render(<ChatArea />)
    handlers.onResult({ localSessionId: 's1', costUSD: 0.05, durationMs: 1000, turns: 3, isError: false })
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'STREAM_END', sessionId: 's1', costUSD: 0.05 }))
  })

  it('onError → STREAM_ERROR', () => {
    render(<ChatArea />)
    handlers.onError({ localSessionId: 's1', error: 'boom' })
    expect(dispatch).toHaveBeenCalledWith({ type: 'STREAM_ERROR', sessionId: 's1', error: 'boom' })
  })

  it('onAborted → STREAM_ABORTED', () => {
    render(<ChatArea />)
    handlers.onAborted({ localSessionId: 's1' })
    expect(dispatch).toHaveBeenCalledWith({ type: 'STREAM_ABORTED', sessionId: 's1' })
  })

  it('onDialogRequest → SHOW_DIALOG', () => {
    render(<ChatArea />)
    handlers.onDialogRequest({ reqId: 'r1', dialogKind: 'ask_user_question', payload: { questions: [] }, toolUseId: 'tu1' })
    expect(dispatch).toHaveBeenCalledWith({ type: 'SHOW_DIALOG', reqId: 'r1', dialogKind: 'ask_user_question', payload: { questions: [] }, toolUseId: 'tu1' })
  })

  it('onDialogRequest plan_proposed → SHOW_DIALOG（ExitPlanMode 走 dialog 通道）', () => {
    render(<ChatArea />)
    handlers.onDialogRequest({ reqId: 'r2', localSessionId: 's1', dialogKind: 'plan_proposed', payload: { plan: '# 计划' }, toolUseId: 'p1' })
    expect(dispatch).toHaveBeenCalledWith({ type: 'SHOW_DIALOG', reqId: 'r2', sessionId: 's1', dialogKind: 'plan_proposed', payload: { plan: '# 计划' }, toolUseId: 'p1' })
  })

  it('无 localSessionId 的 delta → 丢弃（不 dispatch）', () => {
    render(<ChatArea />)
    handlers.onDelta({ kind: 'text', delta: 'x' })  // 无 localSessionId
    expect(dispatch).not.toHaveBeenCalled()
  })
})

describe('ChatArea 渲染', () => {
  beforeEach(() => {
    ;(window as any).api = {
      claude: {
        onSystem() {}, onDelta() {}, onBlocks() {}, onNotice() {}, onTask() {}, onSubagentOutput() {},
        onResult() {}, onError() {}, onAborted() {}, onDialogRequest() {}, onNotification() {},
        removeAllListeners() {},
      },
      backendTask: { onEvent: () => () => {} },
    }
    dispatch.mockClear()
  })

  it('无选中会话 → 显示 chat.noSession', () => {
    mockState = { activeSessionId: '', projects: [], settings: { showTodo: false, showBackendTask: false }, streamingBySession: {} }
    render(<ChatArea />)
    expect(screen.getByText('chat.noSession')).toBeTruthy()
  })

  it('user 消息渲染 is-user 类', () => {
    mockState = {
      activeSessionId: 's1',
      projects: [{ id: 'p1', name: 'p', sessions: [{ id: 's1', title: '', messages: [
        { id: 'm1', role: 'user', content: [{ type: 'text', text: '你好' }] as ContentBlock[] },
      ] }] }],
      settings: { showTodo: false, showBackendTask: false }, streamingBySession: {},
      tasksBySession: {}, backendTasksBySession: {}, subagentOutputBySession: {}, planBySession: {},
      panelFold: { root: false }, panelPosition: { x: 0, y: 0 },
    }
    const { container } = render(<ChatArea />)
    const userMsg = container.querySelector('.is-user')
    expect(userMsg).toBeTruthy()
    expect(userMsg!.textContent).toContain('你好')
  })

  it('assistant 消息渲染 is-assistant 类', () => {
    mockState = {
      activeSessionId: 's1',
      projects: [{ id: 'p1', name: 'p', sessions: [{ id: 's1', title: '', messages: [
        { id: 'm1', role: 'assistant', content: [{ type: 'text', text: '回复' }] as ContentBlock[] },
      ] }] }],
      settings: { showTodo: false, showBackendTask: false }, streamingBySession: {},
      tasksBySession: {}, backendTasksBySession: {}, subagentOutputBySession: {}, planBySession: {},
      panelFold: { root: false }, panelPosition: { x: 0, y: 0 },
    }
    const { container } = render(<ChatArea />)
    expect(container.querySelector('.is-assistant')).toBeTruthy()
  })
})
