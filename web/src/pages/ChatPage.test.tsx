// web/src/pages/ChatPage.test.tsx
// ChatPage 组件交互测试（Task 14）。
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import ChatPage from './ChatPage'
import type { AnyMessage } from '../hooks/useSessionChat'
import type { DialogRequest } from '../lib/dialog-queue'

// jsdom 不实现 scrollTo；ChatPage 进入会话的 effect 会调用，需 polyfill。
beforeAll(() => {
  if (!window.HTMLElement.prototype.scrollTo) {
    window.HTMLElement.prototype.scrollTo = vi.fn()
  }
})

const assistantMsg = (text: string, blocks: any[] = []): AnyMessage => ({
  role: 'assistant',
  text,
  thinking: '',
  blocks,
})

describe('ChatPage - 渲染', () => {
  it('无消息时显示空态', () => {
    render(
      <ChatPage
        title="测试"
        messages={[]}
        running={false}
        inputValue=""
        onInputChange={() => {}}
        onSend={() => {}}
        onInterrupt={() => {}}
        onBack={() => {}}
      />,
    )
    expect(screen.getByText(/还没有消息|开始对话/)).toBeInTheDocument()
  })

  it('渲染 assistant 文本消息', () => {
    render(
      <ChatPage
        title="t"
        messages={[assistantMsg('hello **world**')]}
        running={false}
        inputValue=""
        onInputChange={() => {}}
        onSend={() => {}}
        onInterrupt={() => {}}
        onBack={() => {}}
      />,
    )
    // markdown 简单渲染：**world** → strong
    expect(screen.getByText('world')).toBeInTheDocument()
  })

  it('渲染 user 消息', () => {
    render(
      <ChatPage
        title="t"
        messages={[{ role: 'user', text: '你好' }]}
        running={false}
        inputValue=""
        onInputChange={() => {}}
        onSend={() => {}}
        onInterrupt={() => {}}
        onBack={() => {}}
      />,
    )
    expect(screen.getByText('你好')).toBeInTheDocument()
  })

  it('渲染 tool_use 块', () => {
    render(
      <ChatPage
        title="t"
        messages={[assistantMsg('ok', [{ kind: 'tool_use', label: 'Read', raw: {} }])]}
        running={false}
        inputValue=""
        onInputChange={() => {}}
        onSend={() => {}}
        onInterrupt={() => {}}
        onBack={() => {}}
      />,
    )
    expect(screen.getByText(/Read|工具/)).toBeInTheDocument()
  })

  it('渲染计划卡片块', () => {
    render(
      <ChatPage
        title="t"
        messages={[assistantMsg('ok', [{ kind: 'plan', label: '计划', raw: { payload: { plan: { steps: [] } } } }])]}
        running={false}
        inputValue=""
        onInputChange={() => {}}
        onSend={() => {}}
        onInterrupt={() => {}}
        onBack={() => {}}
      />,
    )
    expect(screen.getByText(/计划/)).toBeInTheDocument()
  })

  it('running 且输入为空时,发送按钮变停止态(可中断)', () => {
    render(
      <ChatPage
        title="t"
        messages={[]}
        running={true}
        inputValue=""
        onInputChange={() => {}}
        onSend={() => {}}
        onInterrupt={() => {}}
        onBack={() => {}}
      />,
    )
    // 发送按钮三态:running+空 → 停止态(aria-label=停止),对齐桌面端
    expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument()
  })
})

describe('ChatPage - 交互', () => {
  it('输入框变化触发 onInputChange', () => {
    const onInputChange = vi.fn()
    render(
      <ChatPage
        title="t"
        messages={[]}
        running={false}
        inputValue=""
        onInputChange={onInputChange}
        onSend={() => {}}
        onInterrupt={() => {}}
        onBack={() => {}}
      />,
    )
    fireEvent.change(screen.getByPlaceholderText(/输入|消息/), { target: { value: 'hi' } })
    expect(onInputChange).toHaveBeenCalledWith('hi')
  })

  it('点发送按钮触发 onSend', () => {
    const onSend = vi.fn()
    render(
      <ChatPage
        title="t"
        messages={[]}
        running={false}
        inputValue="hello"
        onInputChange={() => {}}
        onSend={onSend}
        onInterrupt={() => {}}
        onBack={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /发送/ }))
    expect(onSend).toHaveBeenCalled()
  })

  it('输入为空时发送按钮禁用', () => {
    render(
      <ChatPage
        title="t"
        messages={[]}
        running={false}
        inputValue="   "
        onInputChange={() => {}}
        onSend={() => {}}
        onInterrupt={() => {}}
        onBack={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: /发送/ })).toBeDisabled()
  })

  it('回车触发 onSend（非 Shift+Enter）', () => {
    const onSend = vi.fn()
    render(
      <ChatPage
        title="t"
        messages={[]}
        running={false}
        inputValue="x"
        onInputChange={() => {}}
        onSend={onSend}
        onInterrupt={() => {}}
        onBack={() => {}}
      />,
    )
    const ta = screen.getByPlaceholderText(/输入|消息/)
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: false })
    expect(onSend).toHaveBeenCalled()
  })

  it('Shift+Enter 不触发发送（换行）', () => {
    const onSend = vi.fn()
    render(
      <ChatPage
        title="t"
        messages={[]}
        running={false}
        inputValue="x"
        onInputChange={() => {}}
        onSend={onSend}
        onInterrupt={() => {}}
        onBack={() => {}}
      />,
    )
    fireEvent.keyDown(screen.getByPlaceholderText(/输入|消息/), { key: 'Enter', shiftKey: true })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('running 且空时点发送按钮(停止态)触发 onInterrupt', () => {
    const onInterrupt = vi.fn()
    render(
      <ChatPage
        title="t"
        messages={[]}
        running={true}
        inputValue=""
        onInputChange={() => {}}
        onSend={() => {}}
        onInterrupt={onInterrupt}
        onBack={() => {}}
      />,
    )
    // running+空时发送按钮是停止态,点击应触发 onInterrupt(三态:有内容→发送,流式空→停止)
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    expect(onInterrupt).toHaveBeenCalled()
  })

  it('点返回触发 onBack', () => {
    const onBack = vi.fn()
    render(
      <ChatPage
        title="t"
        messages={[]}
        running={false}
        inputValue=""
        onInputChange={() => {}}
        onSend={() => {}}
        onInterrupt={() => {}}
        onBack={onBack}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /返回|←/ }))
    expect(onBack).toHaveBeenCalled()
  })
})

describe('ChatPage - 批准卡片', () => {
  const dialog: DialogRequest = {
    reqId: 'r1',
    localSessionId: 's1',
    dialogKind: 'plan_proposed',
    payload: { question: '是否授权?' },
  }

  it('有 current dialog 时展示批准卡片', () => {
    render(
      <ChatPage
        title="t"
        messages={[]}
        running={false}
        inputValue=""
        onInputChange={() => {}}
        onSend={() => {}}
        onInterrupt={() => {}}
        onBack={() => {}}
        currentDialog={dialog}
      />,
    )
    expect(screen.getByText('是否批准此计划？')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '批准' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '拒绝' })).toBeInTheDocument()
  })

  it('点批准触发 onApprove(reqId)', () => {
    const onApprove = vi.fn()
    render(
      <ChatPage
        title="t"
        messages={[]}
        running={false}
        inputValue=""
        onInputChange={() => {}}
        onSend={() => {}}
        onInterrupt={() => {}}
        onBack={() => {}}
        currentDialog={dialog}
        onApprove={onApprove}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '批准' }))
    expect(onApprove).toHaveBeenCalledWith('r1')
  })

  it('点拒绝触发 onDeny(reqId)', () => {
    const onDeny = vi.fn()
    render(
      <ChatPage
        title="t"
        messages={[]}
        running={false}
        inputValue=""
        onInputChange={() => {}}
        onSend={() => {}}
        onInterrupt={() => {}}
        onBack={() => {}}
        currentDialog={dialog}
        onDeny={onDeny}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }))
    expect(onDeny).toHaveBeenCalledWith('r1')
  })
})

describe('ChatPage - 进入会话自动滚动', () => {
  beforeAll(() => {
    // 用 spy 替换 polyfill，便于断言被调用
    window.HTMLElement.prototype.scrollTo = vi.fn()
  })

  it('初次进入会话（localSessionId 渲染）触发 scrollToBottom', () => {
    const scrollTo = window.HTMLElement.prototype.scrollTo as unknown as ReturnType<typeof vi.fn>
    scrollTo.mockClear()
    render(
      <ChatPage
        title="会话A"
        localSessionId="s1"
        messages={[assistantMsg('内容')]}
        running={false}
        inputValue=""
        onInputChange={() => {}}
        onSend={() => {}}
        onInterrupt={() => {}}
        onBack={() => {}}
      />,
    )
    // 进入会话的 effect 应无条件触发滚动（对标桌面端 activeSessionId effect）
    expect(scrollTo).toHaveBeenCalled()
  })

  it('切换到另一个会话（localSessionId 变化）再次触发 scrollToBottom', () => {
    const scrollTo = window.HTMLElement.prototype.scrollTo as unknown as ReturnType<typeof vi.fn>
    scrollTo.mockClear()
    const { rerender } = render(
      <ChatPage
        title="会话A"
        localSessionId="s1"
        messages={[assistantMsg('A')]}
        running={false}
        inputValue=""
        onInputChange={() => {}}
        onSend={() => {}}
        onInterrupt={() => {}}
        onBack={() => {}}
      />,
    )
    scrollTo.mockClear()
    // 切到另一个会话（即使 title 相同也用 localSessionId 判定）
    rerender(
      <ChatPage
        title="会话B"
        localSessionId="s2"
        messages={[assistantMsg('B')]}
        running={false}
        inputValue=""
        onInputChange={() => {}}
        onSend={() => {}}
        onInterrupt={() => {}}
        onBack={() => {}}
      />,
    )
    expect(scrollTo).toHaveBeenCalled()
  })
})

describe('ChatPage - 发送参数控件(权限/思考)', () => {
  const baseProps = {
    title: 't', messages: [], running: false,
    inputValue: '', onInputChange: () => {}, onSend: () => {},
    onInterrupt: () => {}, onBack: () => {},
  }

  it('传入 setter 时渲染权限/思考两个 select,选中值正确', () => {
    render(
      <ChatPage
        {...baseProps}
        currentPermission="计划模式"
        currentThinking="high"
        onPermissionChange={() => {}}
        onThinkingChange={() => {}}
      />,
    )
    const permSelect = screen.getByLabelText('权限模式') as HTMLSelectElement
    const thinkSelect = screen.getByLabelText('思考强度') as HTMLSelectElement
    expect(permSelect.value).toBe('计划模式')
    expect(thinkSelect.value).toBe('high')
    // 选项齐全
    expect(permSelect.options.length).toBe(4)
    expect(thinkSelect.options.length).toBe(3)
  })

  it('未传 currentPermission/currentThinking 时 select 用默认值(变更前确认/medium)', () => {
    render(
      <ChatPage
        {...baseProps}
        onPermissionChange={() => {}}
        onThinkingChange={() => {}}
      />,
    )
    expect((screen.getByLabelText('权限模式') as HTMLSelectElement).value).toBe('变更前确认')
    expect((screen.getByLabelText('思考强度') as HTMLSelectElement).value).toBe('medium')
  })

  it('改权限 select → 触发 onPermissionChange(新值)', () => {
    const onPermissionChange = vi.fn()
    render(
      <ChatPage
        {...baseProps}
        currentPermission="变更前确认"
        onPermissionChange={onPermissionChange}
        onThinkingChange={() => {}}
      />,
    )
    fireEvent.change(screen.getByLabelText('权限模式'), { target: { value: '完全访问' } })
    expect(onPermissionChange).toHaveBeenCalledWith('完全访问')
  })

  it('改思考 select → 触发 onThinkingChange(新值)', () => {
    const onThinkingChange = vi.fn()
    render(
      <ChatPage
        {...baseProps}
        currentThinking="medium"
        onPermissionChange={() => {}}
        onThinkingChange={onThinkingChange}
      />,
    )
    fireEvent.change(screen.getByLabelText('思考强度'), { target: { value: 'low' } })
    expect(onThinkingChange).toHaveBeenCalledWith('low')
  })

  it('未传任何 setter 时不渲染控件栏(向后兼容)', () => {
    render(<ChatPage {...baseProps} />)
    expect(screen.queryByLabelText('权限模式')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('思考强度')).not.toBeInTheDocument()
  })
})

describe('ChatPage - 图片附件', () => {
  const baseProps = {
    title: 't', messages: [], running: false,
    inputValue: '', onInputChange: () => {}, onSend: () => {},
    onInterrupt: () => {}, onBack: () => {},
  }

  it('传入 attachments → 渲染对应数量的缩略图 chip + 删除按钮', () => {
    const attachments = [
      { mediaType: 'image/png', data: 'aaa', name: 'a.png' },
      { mediaType: 'image/jpeg', data: 'bbb', name: 'b.jpg' },
    ]
    render(
      <ChatPage
        {...baseProps}
        attachments={attachments}
        onAddImages={() => {}}
        onRemoveImage={() => {}}
      />,
    )
    // 两张缩略图(data URL 形式)
    const imgs = screen.getAllByRole('img') as HTMLImageElement[]
    expect(imgs.length).toBe(2)
    expect(imgs[0].src).toContain('data:image/png;base64,aaa')
    // 两个删除按钮
    expect(screen.getAllByLabelText(/删除|移除/).length).toBe(2)
  })

  it('点 chip 的删除按钮 → onRemoveImage(index)', () => {
    const onRemoveImage = vi.fn()
    render(
      <ChatPage
        {...baseProps}
        attachments={[{ mediaType: 'image/png', data: 'aaa' }]}
        onAddImages={() => {}}
        onRemoveImage={onRemoveImage}
      />,
    )
    fireEvent.click(screen.getAllByLabelText(/删除|移除/)[0])
    expect(onRemoveImage).toHaveBeenCalledWith(0)
  })

  it('点「＋」→ 弹出拍照/相册菜单', () => {
    render(
      <ChatPage
        {...baseProps}
        attachments={[]}
        onAddImages={() => {}}
        onRemoveImage={() => {}}
      />,
    )
    fireEvent.click(screen.getByLabelText(/添加|附件|图片/))
    expect(screen.getByText(/拍照/)).toBeInTheDocument()
    expect(screen.getByText(/相册/)).toBeInTheDocument()
  })

  it('未传 onAddImages 时不渲染「＋」按钮(向后兼容)', () => {
    render(<ChatPage {...baseProps} />)
    expect(screen.queryByLabelText(/添加|附件|图片/)).not.toBeInTheDocument()
  })
})

describe('ChatPage - 编辑重发', () => {
  const userMsg = (text: string): AnyMessage => ({ role: 'user', text })
  const assistantMsg = (text: string): AnyMessage => ({ role: 'assistant', text, thinking: '', blocks: [] })
  const baseProps = {
    title: 't', running: false,
    inputValue: '', onInputChange: () => {}, onSend: () => {},
    onInterrupt: () => {}, onBack: () => {},
  }

  it('最后一条 user 消息(非running)显示编辑按钮', () => {
    render(
      <ChatPage
        {...baseProps}
        messages={[userMsg('问题'), assistantMsg('回复'), userMsg('最后一个问题')]}
        editingIndex={null}
        onStartEdit={() => {}}
        onCancelEdit={() => {}}
        onEditResend={() => {}}
      />,
    )
    // 只在最后一条 user 消息上有编辑按钮(共1个)
    expect(screen.getAllByLabelText(/编辑/).length).toBe(1)
  })

  it('running 时不显示编辑按钮', () => {
    render(
      <ChatPage
        {...baseProps}
        running={true}
        messages={[userMsg('问题')]}
        editingIndex={null}
        onStartEdit={() => {}}
        onCancelEdit={() => {}}
        onEditResend={() => {}}
      />,
    )
    expect(screen.queryByLabelText(/编辑/)).not.toBeInTheDocument()
  })

  it('editingIndex 命中时,该消息原位变 textarea(初始值=消息文本)+ 保存/取消', () => {
    render(
      <ChatPage
        {...baseProps}
        messages={[userMsg('待编辑')]}
        editingIndex={0}
        onStartEdit={() => {}}
        onCancelEdit={() => {}}
        onEditResend={() => {}}
      />,
    )
    const textarea = screen.getByDisplayValue('待编辑') as HTMLTextAreaElement
    expect(textarea.value).toBe('待编辑')
    expect(screen.getByRole('button', { name: /保存/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /取消/ })).toBeInTheDocument()
  })

  it('点保存 → onEditResend(index, 新文本)', () => {
    const onEditResend = vi.fn()
    render(
      <ChatPage
        {...baseProps}
        messages={[userMsg('原文')]}
        editingIndex={0}
        onStartEdit={() => {}}
        onCancelEdit={() => {}}
        onEditResend={onEditResend}
      />,
    )
    const textarea = screen.getByDisplayValue('原文') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '改后' } })
    fireEvent.click(screen.getByRole('button', { name: /保存/ }))
    expect(onEditResend).toHaveBeenCalledWith(0, '改后')
  })

  it('点取消 → onCancelEdit', () => {
    const onCancelEdit = vi.fn()
    render(
      <ChatPage
        {...baseProps}
        messages={[userMsg('原文')]}
        editingIndex={0}
        onStartEdit={() => {}}
        onCancelEdit={onCancelEdit}
        onEditResend={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /取消/ }))
    expect(onCancelEdit).toHaveBeenCalled()
  })

  it('点编辑按钮 → onStartEdit(该消息 index)', () => {
    const onStartEdit = vi.fn()
    render(
      <ChatPage
        {...baseProps}
        messages={[userMsg('问题'), assistantMsg('回复'), userMsg('最后')]}
        editingIndex={null}
        onStartEdit={onStartEdit}
        onCancelEdit={() => {}}
        onEditResend={() => {}}
      />,
    )
    fireEvent.click(screen.getAllByLabelText(/编辑/)[0])
    expect(onStartEdit).toHaveBeenCalledWith(2) // 最后一条 user 在 index 2
  })

  it('未传 onEditResend 时不渲染编辑按钮(向后兼容)', () => {
    render(<ChatPage {...baseProps} messages={[userMsg('x')]} />)
    expect(screen.queryByLabelText(/编辑/)).not.toBeInTheDocument()
  })
})

describe('ChatPage - 排队模式', () => {
  const baseProps = {
    title: 't', messages: [], running: false,
    inputValue: '', onInputChange: () => {}, onSend: () => {},
    onInterrupt: () => {}, onBack: () => {},
  }

  it('传入 onQueueModeChange 时渲染模式 select,选中值正确', () => {
    render(
      <ChatPage
        {...baseProps}
        currentQueueMode="guide"
        onQueueModeChange={() => {}}
      />,
    )
    const select = screen.getByLabelText('排队模式') as HTMLSelectElement
    expect(select.value).toBe('guide')
    expect(select.options.length).toBe(2) // queue / guide
  })

  it('改模式 select → onQueueModeChange(新值)', () => {
    const onQueueModeChange = vi.fn()
    render(
      <ChatPage
        {...baseProps}
        currentQueueMode="queue"
        onQueueModeChange={onQueueModeChange}
      />,
    )
    fireEvent.change(screen.getByLabelText('排队模式'), { target: { value: 'guide' } })
    expect(onQueueModeChange).toHaveBeenCalledWith('guide')
  })

  it('queue 非空 → 渲染对应数量的排队 chip', () => {
    render(
      <ChatPage
        {...baseProps}
        queue={['排队消息1', '排队消息2']}
      />,
    )
    const chips = screen.getAllByText(/排队消息/)
    expect(chips.length).toBe(2)
  })

  it('未传 onQueueModeChange 时不渲染模式 select(向后兼容)', () => {
    render(<ChatPage {...baseProps} />)
    expect(screen.queryByLabelText('排队模式')).not.toBeInTheDocument()
  })
})
