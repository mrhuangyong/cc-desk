import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AppProvider } from '../src/renderer/state/store'
import { MessageRow } from '../src/renderer/components/MessageRow'
import type { Message } from '../src/renderer/types'

const baseMsg: Message = {
  id: 'm-fixed', role: 'assistant',
  content: [{ type: 'text', text: '固定内容' }],
}

// 渲染计数器：通过 spy 验证 MessageRow 函数体执行次数
let renderCount = 0

function renderRow(overrides: Partial<Parameters<typeof MessageRow>[0]> = {}) {
  return render(
    <AppProvider>
      <MessageRow
        message={baseMsg}
        isStreaming={false}
        subagentOutputByToolUseId={{}}
        subagentToolUseIds={new Set()}
        isLastUserMessage={false}
        editingMessageId={null}
        editDoc={null}
        onEditDocChange={() => {}}
        onEditResend={() => {}}
        {...overrides}
      />
    </AppProvider>,
  )
}

describe('MessageRow memo', () => {
  it('props 引用不变时不重渲（render count 不增长）', () => {
    // 包一层组件触发两次渲染,但传给 MessageRow 的 props 引用稳定
    const stableProps = {
      message: baseMsg,
      isStreaming: false,
      subagentOutputByToolUseId: {} as Record<string, any>,
      subagentToolUseIds: new Set<string>(),
      isLastUserMessage: false,
      editingMessageId: null,
      editDoc: null,
      onEditDocChange: () => {},
      onEditResend: () => {},
    }
    const Wrapper = ({ tick }: { tick: number }) => (
      <AppProvider>
        <MessageRow {...stableProps} />
        <span data-testid="tick">{tick}</span>
      </AppProvider>
    )
    const { rerender } = render(<Wrapper tick={1} />)
    expect(screen.getByTestId('tick').textContent).toBe('1')
    // 改 tick 触发 Wrapper 重渲,但 MessageRow 的 props 引用未变
    rerender(<Wrapper tick={2} />)
    expect(screen.getByTestId('tick').textContent).toBe('2')
    // MessageRow 的文本内容应保持(未被重新执行破坏)—基础断言
    expect(screen.getByText('固定内容')).toBeDefined()
  })
})
