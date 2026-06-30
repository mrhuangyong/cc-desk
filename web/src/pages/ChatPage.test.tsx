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

  it('渲染 notice 消息', () => {
    render(
      <ChatPage
        title="t"
        messages={[{ role: 'notice', text: 'API 重试中', level: 'warn' } as any]}
        running={false}
        inputValue=""
        onInputChange={() => {}}
        onSend={() => {}}
        onInterrupt={() => {}}
        onBack={() => {}}
      />,
    )
    expect(screen.getByText('API 重试中')).toBeInTheDocument()
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

  it('tool_use 块按 status 渲染对应状态类名（completed/error/running）', () => {
    const mk = (status: any) => assistantMsg('ok', [{ kind: 'tool_use', label: 'Bash: ls', status, raw: {} }])
    const { rerender } = render(<ChatPage title="t" messages={[mk('completed')]} running={false} inputValue="" onInputChange={() => {}} onSend={() => {}} onInterrupt={() => {}} onBack={() => {}} />)
    expect(document.querySelector('.block.tool-use.status-completed')).toBeTruthy()
    rerender(<ChatPage title="t" messages={[mk('error')]} running={false} inputValue="" onInputChange={() => {}} onSend={() => {}} onInterrupt={() => {}} onBack={() => {}} />)
    expect(document.querySelector('.block.tool-use.status-error')).toBeTruthy()
    rerender(<ChatPage title="t" messages={[mk('running')]} running={false} inputValue="" onInputChange={() => {}} onSend={() => {}} onInterrupt={() => {}} onBack={() => {}} />)
    expect(document.querySelector('.block.tool-use.status-running')).toBeTruthy()
  })

  it('tool_use 块点击展开显示入参+结果', () => {
    const block = {
      kind: 'tool_use', label: 'Bash: ls', status: 'completed', name: 'Bash',
      raw: { input: { command: 'ls -la' } },
      result: { content: 'file1\nfile2', isError: false },
    }
    render(
      <ChatPage title="t" messages={[assistantMsg('ok', [block] as any)]} running={false}
        inputValue="" onInputChange={() => {}} onSend={() => {}} onInterrupt={() => {}} onBack={() => {}} />,
    )
    // 初始未展开:详情不可见
    expect(document.querySelector('.block-detail')).toBeNull()
    // 点击 head 展开
    fireEvent.click(document.querySelector('.block-head')!)
    expect(document.querySelector('.block-detail')).toBeTruthy()
    expect(screen.getByText('入参')).toBeInTheDocument()
    expect(screen.getByText('结果')).toBeInTheDocument()
    // pre 里含结果文本(testing-library 折叠空白,用 querySelector 取 textContent)
    const pres = document.querySelectorAll('.block-detail-pre')
    expect(Array.from(pres).some(p => (p as HTMLElement).textContent?.includes('file1'))).toBe(true)
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

  it('只有附件没有文本时发送按钮可用并触发 onSend', () => {
    const onSend = vi.fn()
    render(
      <ChatPage
        title="t"
        messages={[]}
        running={false}
        inputValue=""
        onInputChange={() => {}}
        onSend={onSend}
        onInterrupt={() => {}}
        onBack={() => {}}
        attachments={[{ mediaType: 'image/png', data: 'aaa', name: 'a.png' }]}
        onAddImages={() => {}}
        onRemoveImage={() => {}}
      />,
    )
    const btn = screen.getByRole('button', { name: /发送/ })
    expect(btn).not.toBeDisabled()
    fireEvent.click(btn)
    expect(onSend).toHaveBeenCalled()
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

describe('ChatPage - 批准卡片（permission_request 授权框）', () => {
  const dialog: DialogRequest = {
    reqId: 'r1',
    localSessionId: 's1',
    dialogKind: 'permission_request',
    payload: { toolName: 'Write', displayName: '写文件', input: { file_path: '/a/b.txt' } },
  }

  it('permission_request 时展示授权确认框（拒绝/批准）', () => {
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
    expect(screen.getByText('写文件')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '批准' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '拒绝' })).toBeInTheDocument()
  })

  it('点批准触发 onApprove(reqId)（无额外 opts）', () => {
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

describe('ChatPage - AskQuestionSheet（ask_user_question 问答向导）', () => {
  const dialog: DialogRequest = {
    reqId: 'a1',
    localSessionId: 's1',
    dialogKind: 'ask_user_question',
    payload: {
      questions: [
        {
          question: '用哪个库？',
          header: '依赖',
          options: [{ label: 'lodash', description: '工具函数' }, { label: 'ramda' }],
        },
      ],
    },
  }

  it('ask_user_question 时渲染问题文本与选项', () => {
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
        onApprove={() => {}}
        onDeny={() => {}}
      />,
    )
    expect(screen.getByText('用哪个库？')).toBeInTheDocument()
    expect(screen.getByText('lodash')).toBeInTheDocument()
    expect(screen.getByText('ramda')).toBeInTheDocument()
  })

  it('选中选项后点提交 → onApprove(reqId, {answers})', () => {
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
        onDeny={() => {}}
      />,
    )
    fireEvent.click(screen.getByText('lodash'))
    fireEvent.click(screen.getByRole('button', { name: /提交/ }))
    expect(onApprove).toHaveBeenCalledWith('a1', {
      answers: [{ questionIndex: 0, selected: { index: 0, label: 'lodash' } }],
    })
  })

  it('点取消按钮 → onDeny(reqId)', () => {
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
        onApprove={() => {}}
        onDeny={onDeny}
      />,
    )
    fireEvent.click(screen.getByLabelText('取消'))
    expect(onDeny).toHaveBeenCalledWith('a1')
  })
})

describe('ChatPage - PlanSheet（plan_proposed 计划批准）', () => {
  const dialog: DialogRequest = {
    reqId: 'p1',
    localSessionId: 's1',
    dialogKind: 'plan_proposed',
    payload: { plan: '第一步：**重构** 入口\n第二步：加测试' },
  }

  it('plan_proposed 时渲染计划文本（markdown 行内）', () => {
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
        onApprove={() => {}}
        onDeny={() => {}}
      />,
    )
    // 粗体渲染：**重构** → strong
    expect(screen.getByText('重构')).toBeInTheDocument()
    // 权限模式两选项
    expect(screen.getByText('自动编辑')).toBeInTheDocument()
    expect(screen.getByText('完全访问')).toBeInTheDocument()
  })

  it('点批准 → onApprove(reqId, {permissionMode})（默认自动编辑）', () => {
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
        onDeny={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '批准' }))
    expect(onApprove).toHaveBeenCalledWith('p1', { permissionMode: '自动编辑' })
  })

  it('选「完全访问」后批准 → onApprove(reqId, {permissionMode:"完全访问"})', () => {
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
        onDeny={() => {}}
      />,
    )
    fireEvent.click(screen.getByText('完全访问'))
    fireEvent.click(screen.getByRole('button', { name: '批准' }))
    expect(onApprove).toHaveBeenCalledWith('p1', { permissionMode: '完全访问' })
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

  // 排队模式 select 已移除(移动端默认 queue),保留队列 chip 可见性测试
  it('queue 非空 → 渲染对应数量的排队 chip', () => {
    render(
      <ChatPage
        {...baseProps}
        queue={[{ text: '排队消息1' }, { text: '排队消息2' }] as any}
      />,
    )
    const chips = screen.getAllByText(/排队消息/)
    expect(chips.length).toBe(2)
  })
})
