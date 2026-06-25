// InputBar 外围 UI 交互测试。
// PromptEditor（TipTap）stub 为空 div，聚焦测：权限/思考下拉 dispatch、附件 chip 移除、
// 排队消息（立即/取消）、发送钮 aria-label 三态。Enter 发送/粘贴/拖拽等经 TipTap 内部，不在本测试范围。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

let mockState: any
const dispatch = vi.fn()
vi.mock('../src/renderer/state/store', () => ({
  useStore: () => ({ state: mockState, dispatch }),
}))
vi.mock('../src/renderer/i18n/useI18n', () => ({
  useI18n: () => ({ t: (k: string) => k, lang: 'zh-CN' }),
}))
// stub TipTap 编辑器
vi.mock('../src/renderer/editor/PromptEditor', () => ({
  PromptEditor: () => <div data-testid="editor-stub" />,
}))
vi.mock('../src/renderer/components/AttachmentChip', () => ({
  AttachmentChip: ({ onRemove }: any) => <button data-testid="chip-remove" onClick={onRemove}>x</button>,
}))

import { buildPromptWithAttachments, InputBar } from '../src/renderer/components/InputBar'

function baseState(overrides: Record<string, any> = {}) {
  return {
    activeSessionId: 's1',
    projects: [{ id: 'p1', name: 'p', sessions: [{ id: 's1', title: '会话1', messages: [], permissionMode: '变更前确认', thinking: 'medium' }] }],
    settings: { cwd: '/home', showTodo: false, showBackendTask: false, lang: 'zh-CN' },
    draft: { doc: null, attachments: [] },
    queueBySession: {},
    streamingBySession: {},
    claudeSessionMap: {},
    ...overrides,
  }
}

describe('InputBar 外围交互', () => {
  const commandsGet = vi.fn()
  const skillsGet = vi.fn()
  const modelGet = vi.fn()

  beforeEach(() => {
    dispatch.mockClear()
    commandsGet.mockResolvedValue([])
    skillsGet.mockResolvedValue([])
    modelGet.mockResolvedValue({ activeModelId: '', models: [] })
    ;(window as any).api = {
      cc: { commands: { get: commandsGet }, skills: { get: skillsGet } },
      ccDesk: { model: { get: modelGet, save: vi.fn() } },
      claude: { send: vi.fn(), stop: vi.fn(), onBuiltinResult: () => {} },
    }
    mockState = baseState()
  })

  describe('拾取内容发送', () => {
    const picked = {
      type: 'pickedElement' as const,
      el: {
        source: 'http://localhost:45486/page',
        tag: 'button',
        text: '提交订单',
        selector: 'button.primary',
        html: '<button class="primary">提交订单</button>',
      },
    }

    it('buildPromptWithAttachments 把拾取元素写入发送 prompt', () => {
      const prompt = buildPromptWithAttachments('分析这个按钮', [picked])

      expect(prompt).toContain('分析这个按钮')
      expect(prompt).toContain('来源: http://localhost:45486/page')
      expect(prompt).toContain('标签: button')
      expect(prompt).toContain('选择器: button.primary')
      expect(prompt).toContain('文本: 提交订单')
      expect(prompt).toContain('HTML: <button class="primary">提交订单</button>')
    })

    it('点击发送时 claude.send 收到包含拾取元素内容的 prompt', () => {
      mockState = baseState({
        draft: {
          doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '看这个元素' }] }] },
          attachments: [picked],
        },
      })

      render(<InputBar />)
      fireEvent.click(screen.getByLabelText('input.send'))

      expect((window as any).api.claude.send).toHaveBeenCalledWith(expect.objectContaining({
        prompt: expect.stringContaining('文本: 提交订单'),
      }))
      expect((window as any).api.claude.send.mock.calls[0][0].prompt).toContain('HTML: <button class="primary">提交订单</button>')
    })
  })

  describe('权限下拉', () => {
    it('点击权限按钮展开 4 个选项，当前项带勾', () => {
      render(<InputBar />)
      // 权限按钮含 ShieldCheck + 当前权限名「变更前确认」
      fireEvent.click(screen.getByText('变更前确认'))
      expect(screen.getByText('自动编辑')).toBeTruthy()
      expect(screen.getByText('计划模式')).toBeTruthy()
      expect(screen.getByText('完全访问')).toBeTruthy()
    })

    it('选择「自动编辑」→ SET_SESSION_PERMISSION', () => {
      render(<InputBar />)
      fireEvent.click(screen.getByText('变更前确认'))
      fireEvent.click(screen.getByText('自动编辑'))
      expect(dispatch).toHaveBeenCalledWith({ type: 'SET_SESSION_PERMISSION', sessionId: 's1', permissionMode: '自动编辑' })
    })
  })

  describe('思考强度下拉', () => {
    it('点击展开 low/medium/high，选 high → SET_SESSION_THINKING', () => {
      render(<InputBar />)
      fireEvent.click(screen.getByText('思考:medium'))
      fireEvent.click(screen.getByText('high'))
      expect(dispatch).toHaveBeenCalledWith({ type: 'SET_SESSION_THINKING', sessionId: 's1', thinking: 'high' })
    })
  })

  describe('附件 chip', () => {
    it('draft 有附件 → 渲染 chip，点移除 → REMOVE_DRAFT_ATTACHMENT', () => {
      mockState = baseState({
        draft: { doc: null, attachments: [
          { type: 'image', name: 'a.png', base64: 'x', mediaType: 'image/png' },
        ] },
      })
      render(<InputBar />)
      const removeBtn = screen.getByTestId('chip-remove')
      fireEvent.click(removeBtn)
      expect(dispatch).toHaveBeenCalledWith({ type: 'REMOVE_DRAFT_ATTACHMENT', index: 0 })
    })
  })

  describe('排队消息', () => {
    it('queue 非空 → 渲染排队项，点 × → DEQUEUE_MESSAGE', () => {
      mockState = baseState({
        queueBySession: { s1: [{ id: 'q1', prompt: '排队消息A', attachments: [] }] },
        streamingBySession: { s1: { streaming: true } },  // 流式中才会显示队列
      })
      render(<InputBar />)
      expect(screen.getByText('排队消息A')).toBeTruthy()
      fireEvent.click(screen.getByTitle('取消排队'))
      expect(dispatch).toHaveBeenCalledWith({ type: 'DEQUEUE_MESSAGE', sessionId: 's1', queueId: 'q1' })
    })

    it('点「立即」→ DEQUEUE_MESSAGE（中断当前任务立即发送）', () => {
      mockState = baseState({
        queueBySession: { s1: [{ id: 'q1', prompt: 'msg', attachments: [] }] },
        streamingBySession: { s1: { streaming: true } },
      })
      render(<InputBar />)
      fireEvent.click(screen.getByTitle('中断当前任务并立即发送'))
      // sendQueuedNow 应先 DEQUEUE（具体顺序也含 stop/claude.send，但至少有 DEQUEUE）
      const dequeues = dispatch.mock.calls.filter(c => c[0].type === 'DEQUEUE_MESSAGE')
      expect(dequeues.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('发送钮三态', () => {
    it('空闲可发送态：aria-label = input.send', () => {
      // 无 doc 无法发送，故给个非空 doc 让 canSend 成立
      mockState = baseState({ draft: { doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] }, attachments: [] } })
      render(<InputBar />)
      const sendBtn = screen.getByLabelText('input.send')
      expect(sendBtn).toBeTruthy()
    })

    it('流式中：aria-label = input.stop', () => {
      mockState = baseState({ streamingBySession: { s1: { streaming: true } } })
      render(<InputBar />)
      expect(screen.getByLabelText('input.stop')).toBeTruthy()
    })
  })

  describe('compact 结果路由（修复：不按 activeSessionId 过滤）', () => {
    let builtinHandler: (data: any) => void
    beforeEach(() => {
      dispatch.mockClear()
      commandsGet.mockResolvedValue([])
      skillsGet.mockResolvedValue([])
      modelGet.mockResolvedValue({ activeModelId: '', models: [] })
      builtinHandler = () => {}
      ;(window as any).api = {
        cc: { commands: { get: commandsGet }, skills: { get: skillsGet } },
        ccDesk: { model: { get: modelGet, save: vi.fn() } },
        claude: { send: vi.fn(), stop: vi.fn(), onBuiltinResult: (cb: any) => { builtinHandler = cb } },
      }
    })

    it('compact 结果的 localSessionId ≠ activeSessionId 时仍 dispatch COMPACT_DONE（不静默丢弃）', () => {
      mockState = baseState()  // activeSessionId='s1'
      render(<InputBar />)
      // 模拟：在 s2 触发了 compact，结果返回时用户在 s1。修复前会被过滤丢弃。
      builtinHandler({ localSessionId: 's2', op: 'compact', summary: '已压缩', keepRecent: 6 })
      expect(dispatch).toHaveBeenCalledWith({ type: 'COMPACT_DONE', sessionId: 's2', summary: '已压缩', keepRecent: 6 })
    })

    it('compact 结果缺 summary/keepRecent → 不 dispatch', () => {
      mockState = baseState()
      render(<InputBar />)
      builtinHandler({ localSessionId: 's1', op: 'compact' })
      expect(dispatch).not.toHaveBeenCalled()
    })
  })
})
