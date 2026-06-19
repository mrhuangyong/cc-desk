// AnswerPanel 交互测试：AskUserQuestion 的渲染端。
// 覆盖单选/多选 toggle、Other 输入、answered 启用、submit 序列化 dialogResponse、cancel。
// 这是 AskUserQuestion 完整链路的用户交互端（与 forward-event-identity 的识别端互补）。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// 可控 store：每次渲染前注入 state + dispatch
let mockState: any
const dispatch = vi.fn()
vi.mock('../src/renderer/state/store', () => ({
  useStore: () => ({ state: mockState, dispatch }),
}))

import { AnswerPanel } from '../src/renderer/components/AnswerPanel'

describe('AnswerPanel', () => {
  beforeEach(() => {
    dispatch.mockClear()
    ;(window as any).api = { claude: { dialogResponse: vi.fn() } }
  })

  function setState(questions: any[], reqId = 'r1') {
    mockState = { pendingDialog: { reqId, dialogKind: 'ask_user_question', payload: { questions }, toolUseId: 'tu1' } }
  }

  it('无问题（total=0）→ 不渲染', () => {
    setState([])
    const { container } = render(<AnswerPanel />)
    expect(container.firstChild).toBeNull()
  })

  describe('单选', () => {
    const oneQ = [{ question: '选语言?', header: '语言', options: [{ label: 'TS' }, { label: 'JS' }] }]

    it('渲染问题与选项，默认提交禁用', () => {
      setState(oneQ)
      render(<AnswerPanel />)
      expect(screen.getByText('选语言?')).toBeTruthy()
      expect(screen.getByText('TS')).toBeTruthy()
      expect(screen.getByText('提交').closest('button')!.disabled).toBe(true)
    })

    it('选一个选项 → 提交启用 → 提交 dialogResponse 正确序列化', () => {
      setState(oneQ)
      render(<AnswerPanel />)
      fireEvent.click(screen.getByText('TS'))
      const submitBtn = screen.getByText('提交').closest('button')!
      expect(submitBtn.disabled).toBe(false)

      fireEvent.click(submitBtn)
      expect((window as any).api.claude.dialogResponse).toHaveBeenCalledWith({
        reqId: 'r1',
        result: { behavior: 'completed', result: { answers: [{ questionIndex: 0, selected: { index: 0, label: 'TS' } }] } },
      })
      expect(dispatch).toHaveBeenCalledWith({ type: 'ANSWER_DIALOG' })
    })

    it('单选 Other：需输入文本才启用提交，提交序列化 other', () => {
      setState(oneQ)
      render(<AnswerPanel />)
      fireEvent.click(screen.getByText('Other…'))
      const input = screen.getByPlaceholderText('自定义回答')
      fireEvent.change(input, { target: { value: 'Rust' } })
      const submitBtn = screen.getByText('提交').closest('button')!
      expect(submitBtn.disabled).toBe(false)
      fireEvent.click(submitBtn)
      expect((window as any).api.claude.dialogResponse).toHaveBeenCalledWith({
        reqId: 'r1',
        result: { behavior: 'completed', result: { answers: [{ questionIndex: 0, other: 'Rust' }] } },
      })
    })

    it('单选 Other 空文本 → 提交保持禁用（answered=false）', () => {
      setState(oneQ)
      render(<AnswerPanel />)
      fireEvent.click(screen.getByText('Other…'))
      const input = screen.getByPlaceholderText('自定义回答')
      fireEvent.change(input, { target: { value: '   ' } })  // 仅空白
      expect(screen.getByText('提交').closest('button')!.disabled).toBe(true)
    })
  })

  describe('多选', () => {
    const multiQ = [{ question: '选框架?', multiSelect: true, options: [{ label: 'React' }, { label: 'Vue' }, { label: 'Svelte' }] }]

    it('显示「可多选」标识', () => {
      setState(multiQ)
      render(<AnswerPanel />)
      expect(screen.getByText('可多选')).toBeTruthy()
    })

    it('多选 toggle：点两次同一项取消，点两项得 2 个', () => {
      setState(multiQ)
      render(<AnswerPanel />)
      const react = screen.getByText('React')
      const vue = screen.getByText('Vue')
      fireEvent.click(react)   // 选 React
      fireEvent.click(vue)     // 选 Vue
      fireEvent.click(react)   // 取消 React
      fireEvent.click(screen.getByText('提交').closest('button')!)
      const call = (window as any).api.claude.dialogResponse.mock.calls[0][0]
      const selected = call.result.result.answers.map((a: any) => a.selected?.label)
      expect(selected).toEqual(['Vue'])  // 仅 Vue
    })

    it('多选 Other：累加进数组，提交时 other 与 selected 混合', () => {
      setState(multiQ)
      render(<AnswerPanel />)
      fireEvent.click(screen.getByText('Svelte'))  // 选普通项
      fireEvent.click(screen.getByText('Other…'))
      const input = screen.getByPlaceholderText('自定义回答')
      // 多选 Other 输入用 onBlur（非 onChange）——见 AnswerPanel.tsx
      fireEvent.change(input, { target: { value: 'Solid' } })
      fireEvent.blur(input)
      fireEvent.click(screen.getByText('提交').closest('button')!)
      const call = (window as any).api.claude.dialogResponse.mock.calls[0][0]
      const answers = call.result.result.answers
      expect(answers.find((a: any) => a.selected?.label === 'Svelte')).toBeTruthy()
      expect(answers.find((a: any) => a.other === 'Solid')).toBeTruthy()
    })
  })

  describe('多步向导', () => {
    const twoQ = [
      { question: '第一题?', options: [{ label: 'A' }] },
      { question: '第二题?', options: [{ label: 'B' }] },
    ]

    it('两题：第一步显示「下一步」，答完推进到第二步显示「提交」', () => {
      setState(twoQ)
      render(<AnswerPanel />)
      expect(screen.getByText('1 / 2')).toBeTruthy()
      expect(screen.getByText('下一步')).toBeTruthy()
      fireEvent.click(screen.getByText('A'))
      fireEvent.click(screen.getByText('下一步').closest('button')!)
      expect(screen.getByText('2 / 2')).toBeTruthy()
      expect(screen.getByText('上一步')).toBeTruthy()
      expect(screen.getByText('提交')).toBeTruthy()
    })

    it('两题全答完提交 → 两条 answers', () => {
      setState(twoQ)
      render(<AnswerPanel />)
      fireEvent.click(screen.getByText('A'))
      fireEvent.click(screen.getByText('下一步').closest('button')!)
      fireEvent.click(screen.getByText('B'))
      fireEvent.click(screen.getByText('提交').closest('button')!)
      const call = (window as any).api.claude.dialogResponse.mock.calls[0][0]
      expect(call.result.result.answers.length).toBe(2)
      expect(call.result.result.answers[0].questionIndex).toBe(0)
      expect(call.result.result.answers[1].questionIndex).toBe(1)
    })
  })

  it('取消 → dialogResponse 带 cancelled + ANSWER_DIALOG', () => {
    setState([{ question: 'q?', options: [{ label: 'X' }] }])
    render(<AnswerPanel />)
    fireEvent.click(screen.getByTitle('取消'))
    expect((window as any).api.claude.dialogResponse).toHaveBeenCalledWith({
      reqId: 'r1', result: { behavior: 'cancelled' },
    })
    expect(dispatch).toHaveBeenCalledWith({ type: 'ANSWER_DIALOG' })
  })

  it('多选 Other：用户输入后直接点提交（即时 onChange 更新）应保留 other 文本', () => {
    // 多选 Other input 同时绑 onChange+onBlur。onChange 即时存值，避免用户输入后直接提交丢失 other。
    setState([{ question: '选框架?', multiSelect: true, options: [{ label: 'React' }, { label: 'Vue' }] }])
    render(<AnswerPanel />)
    fireEvent.click(screen.getByText('Other…'))
    const input = screen.getByPlaceholderText('自定义回答')
    fireEvent.change(input, { target: { value: 'Solid' } })
    fireEvent.click(screen.getByText('提交').closest('button')!)
    const calls = (window as any).api.claude.dialogResponse.mock.calls
    expect(calls.length).toBe(1)
    const answers = calls[0][0].result.result.answers
    expect(answers.find((a: any) => a.other === 'Solid')).toBeTruthy()
  })
})
