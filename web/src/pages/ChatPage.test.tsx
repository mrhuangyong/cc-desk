// web/src/pages/ChatPage.test.tsx
// ChatPage 组件交互测试（Task 14）。
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import ChatPage from './ChatPage'
import type { AnyMessage } from '../hooks/useSessionChat'
import type { DialogRequest } from '../lib/dialog-queue'

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

  it('running 时显示中断按钮', () => {
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
    expect(screen.getByRole('button', { name: /中断|停止/ })).toBeInTheDocument()
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

  it('点中断触发 onInterrupt', () => {
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
    fireEvent.click(screen.getByRole('button', { name: /中断|停止/ }))
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
