// web/src/hooks/useSessionChat.test.tsx
// useSessionChat 的 React 集成测试（Task 14）。
//
// 关注：session.delta 流式拼接、session.blocks 累加、session.result 收尾、
// session.message / session.interrupt 的发送契约。
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSessionChat } from './useSessionChat'
import type { Envelope } from '@shared/remote-protocol-types'

const deltaEnv = (text: string): Envelope => ({
  v: 1, type: 'session.delta', deviceId: 'd', ts: 1, nonce: 'n', sig: '',
  payload: { localSessionId: 's1', text },
})
const thinkingEnv = (t: string): Envelope => ({
  v: 1, type: 'session.delta', deviceId: 'd', ts: 1, nonce: 'n', sig: '',
  payload: { localSessionId: 's1', thinking: t },
})
const blocksEnv = (block: unknown): Envelope => ({
  v: 1, type: 'session.blocks', deviceId: 'd', ts: 1, nonce: 'n', sig: '',
  payload: { localSessionId: 's1', blocks: [block] },
})
const resultEnv = (): Envelope => ({
  v: 1, type: 'session.result', deviceId: 'd', ts: 1, nonce: 'n', sig: '',
  payload: { localSessionId: 's1', subtype: 'result' },
})

describe('useSessionChat - 流式累积', () => {
  it('初始无消息', () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    expect(result.current.messages).toHaveLength(0)
    expect(result.current.running).toBe(false)
  })

  it('session.delta(text) 拼接到当前消息', () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    act(() => {
      result.current.onInbound(deltaEnv('hello'))
      result.current.onInbound(deltaEnv(' world'))
    })
    expect(result.current.messages).toHaveLength(1)
    expect(result.current.messages[0].text).toBe('hello world')
  })

  it('session.delta(thinking) 拼接到 thinking 字段', () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    act(() => {
      result.current.onInbound(thinkingEnv('思'))
      result.current.onInbound(thinkingEnv('考'))
    })
    const m = result.current.messages[0]
    expect(m.role).toBe('assistant')
    expect((m as any).thinking).toBe('思考')
    expect((m as any).text).toBe('')
  })

  it('session.result 收尾：标记 running=false，后续 delta 开新消息', () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    act(() => {
      result.current.onInbound(deltaEnv('a'))
      result.current.onInbound(resultEnv())
    })
    expect(result.current.running).toBe(false)
    act(() => {
      result.current.onInbound(deltaEnv('b')) // 新一轮
    })
    expect(result.current.messages).toHaveLength(2)
    expect(result.current.messages[0].text).toBe('a')
    expect(result.current.messages[1].text).toBe('b')
  })
})

describe('useSessionChat - blocks', () => {
  it('session.blocks 累加 tool_use 块', () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    act(() => {
      result.current.onInbound(deltaEnv('start'))
      result.current.onInbound(blocksEnv({ kind: 'tool_use_start', name: 'Read', id: 't1' }))
    })
    const m = result.current.messages[0] as any
    expect(m.blocks).toHaveLength(1)
    expect(m.blocks[0].kind).toBe('tool_use')
  })

  it('blocks 在无 current 消息时自动新建一条', () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    act(() => {
      result.current.onInbound(blocksEnv({ kind: 'tool_use_start', name: 'Bash', id: 't1' }))
    })
    expect(result.current.messages).toHaveLength(1)
    const m = result.current.messages[0] as any
    expect(m.blocks).toHaveLength(1)
  })

  it('delta 流式拼接后，assistant_blocks 的 text 权威版到来不重复（修复消息重复）', () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    act(() => {
      // 1) delta 流式拼出完整文本
      result.current.onInbound(deltaEnv('你好！有什么我可以帮你的吗？'))
      // 2) assistant_blocks 带同一段文本的权威版（claude:blocks 透传，type:'text'）
      result.current.onInbound(blocksEnv({ type: 'text', text: '你好！有什么我可以帮你的吗？' }))
    })
    const m = result.current.messages[0] as any
    // 权威版应替换流式草稿，而非追加——否则同一段文本显示两次
    expect(m.text).toBe('你好！有什么我可以帮你的吗？')
    expect(m.text.includes('你好！有什么我可以帮你的吗？你好')).toBe(false)
  })

  it('text 块带前导换行时不显示为顶部空行（修复输出空行）', () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    act(() => {
      // SDK 的 assistant text 块常以换行开头（移动端 CSS pre-wrap 会渲染成空行）
      result.current.onInbound(blocksEnv({ type: 'text', text: '\n你好！有什么我可以帮你的吗？' }))
    })
    const m = result.current.messages[0] as any
    // 规范化后首部不应有换行（中间换行保留）
    expect(m.text).toBe('你好！有什么我可以帮你的吗？')
    expect(m.text.startsWith('\n')).toBe(false)
  })

  it('delta 增量带前导换行时，最终 text 不以换行开头', () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    act(() => {
      result.current.onInbound(deltaEnv('\n你好'))
      result.current.onInbound(deltaEnv('世界'))
    })
    const m = result.current.messages[0] as any
    expect(m.text).toBe('你好世界')
    expect(m.text.startsWith('\n')).toBe(false)
  })
})

describe('useSessionChat - 输入与中断', () => {
  it('sendMessage 发 session.message + 本地 echo 一条 user 消息 + 开新 assistant', async () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    await act(async () => {
      await result.current.sendMessage('s1', '你好')
    })
    expect(send).toHaveBeenCalledWith('session.message', { localSessionId: 's1', text: '你好' })
    // user 消息 echo
    expect(result.current.messages.some((m) => m.role === 'user' && m.text === '你好')).toBe(true)
    expect(result.current.running).toBe(true)
  })

  it('空文本不发送', async () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    await act(async () => {
      await result.current.sendMessage('s1', '   ')
    })
    expect(send).not.toHaveBeenCalled()
    expect(result.current.messages).toHaveLength(0)
  })

  it('interrupt 发 session.interrupt', async () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    await act(async () => {
      await result.current.interrupt('s1')
    })
    expect(send).toHaveBeenCalledWith('session.interrupt', { localSessionId: 's1' })
  })
})

describe('useSessionChat - reset', () => {
  it('切换会话清空消息', () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    act(() => {
      result.current.onInbound(deltaEnv('x'))
      result.current.reset()
    })
    expect(result.current.messages).toHaveLength(0)
  })
})

describe('useSessionChat - 历史灌入', () => {
  const historyEnv = (items: any[], hasMore = false): Envelope => ({
    v: 1, type: 'session.history', deviceId: 'd', ts: 1, nonce: 'n', sig: '',
    payload: { localSessionId: 's1', items, hasMore },
  })

  it('session.history 前置历史消息，不触发 running', () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    act(() => {
      result.current.onInbound(historyEnv([
        { role: 'user', text: '历史提问' },
        { role: 'assistant', text: '历史回答', thinking: '思考', blocks: [{ kind: 'tool_use', label: 'Bash' }] },
      ], true))
    })
    expect(result.current.messages).toHaveLength(2)
    expect(result.current.messages[0]).toMatchObject({ role: 'user', text: '历史提问' })
    expect(result.current.messages[1]).toMatchObject({ role: 'assistant', text: '历史回答' })
    expect(result.current.running).toBe(false)
    expect(result.current.hasMoreHistory).toBe(true)
  })

  it('历史灌入后，新 delta 续到历史之后（不串入历史）', () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    act(() => {
      result.current.onInbound(historyEnv([{ role: 'user', text: '历史' }], false))
    })
    act(() => {
      result.current.onInbound(deltaEnv('新流式'))
    })
    expect(result.current.messages).toHaveLength(2)
    expect(result.current.messages[1]).toMatchObject({ role: 'assistant', text: '新流式' })
  })

  it('loadHistory 发 session.history.request', async () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    await act(async () => {
      await result.current.loadHistory('s1', 30)
    })
    expect(send).toHaveBeenCalledWith('session.history.request', { localSessionId: 's1', limit: 30 })
  })

  it('reset 清空 hasMoreHistory', () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    act(() => {
      result.current.onInbound(historyEnv([], true))
    })
    expect(result.current.hasMoreHistory).toBe(true)
    act(() => {
      result.current.reset()
    })
    expect(result.current.hasMoreHistory).toBe(false)
  })
})
