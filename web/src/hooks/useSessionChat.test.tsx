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

  // 修复:桌面 claude:blocks 按 op 分发(tool_use_start 带 block 单数,tool_result 无 blocks 数组),
  // 此前 extractBlocks 只认 payload.blocks/payload.kind → 工具调用全部丢失。
  it('session.blocks payload 是 {op:tool_use_start, block} → 归一化为 tool_use 块', () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    act(() => {
      result.current.onInbound({
        v: 1, type: 'session.blocks', deviceId: 'd', ts: 1, nonce: 'n', sig: '',
        payload: { localSessionId: 's1', op: 'tool_use_start', block: { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } } },
      } as any)
    })
    const m = result.current.messages[0] as any
    expect(m.blocks).toHaveLength(1)
    expect(m.blocks[0].kind).toBe('tool_use')
    expect(m.blocks[0].label).toBe('Bash: ls')
  })

  it('tool_result 合并进同 id 的 tool_use（更新 status，不新增独立块）', () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    act(() => {
      // 先来 tool_use_start
      result.current.onInbound({
        v: 1, type: 'session.blocks', deviceId: 'd', ts: 1, nonce: 'n', sig: '',
        payload: { localSessionId: 's1', op: 'tool_use_start', block: { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } } },
      } as any)
      // 再来同 id 的 tool_result
      result.current.onInbound({
        v: 1, type: 'session.blocks', deviceId: 'd', ts: 1, nonce: 'n', sig: '',
        payload: { localSessionId: 's1', op: 'tool_result', toolUseId: 'tu1', result: { content: 'ok', isError: false } },
      } as any)
    })
    const m = result.current.messages[0] as any
    // 合并：仍是 1 个块（tool_use），status 变 completed，无独立 tool_result 块
    expect(m.blocks).toHaveLength(1)
    expect(m.blocks[0].kind).toBe('tool_use')
    expect(m.blocks[0].status).toBe('completed')
    expect(m.blocks[0].result).toEqual({ content: 'ok', isError: false })
  })

  it('孤儿 tool_result（无匹配 tool_use，如 AskUserQuestion）→ 静默丢弃，不冒 [出错]/[完成]', () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    act(() => {
      result.current.onInbound({
        v: 1, type: 'session.blocks', deviceId: 'd', ts: 1, nonce: 'n', sig: '',
        payload: { localSessionId: 's1', op: 'tool_result', toolUseId: 'orphan', result: { content: 'deny msg', isError: true } },
      } as any)
    })
    // 无匹配 tool_use：丢弃，blocks 为空（不渲染孤立的 tool_result）
    const m = result.current.messages[0] as any
    expect(m.blocks).toHaveLength(0)
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
  it('sendMessage 在传输失败时返回 false，且不本地 echo、不进入 running', async () => {
    const send = vi.fn().mockResolvedValue(false)
    const { result } = renderHook(() => useSessionChat({ send }))

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.sendMessage('s1', '断线消息')
    })

    expect(ok).toBe(false)
    expect(result.current.messages).toHaveLength(0)
    expect(result.current.running).toBe(false)
  })

  it('sendMessage 支持只有图片附件、没有文本的消息', async () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    const images = [{ mediaType: 'image/png', data: 'iVBORw0KGgo=', name: 'x.png' }]

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.sendMessage('s1', '', { images })
    })

    expect(ok).toBe(true)
    expect(send).toHaveBeenCalledWith('session.message', expect.objectContaining({
      localSessionId: 's1',
      text: '',
      images,
    }))
    expect(result.current.messages.some((m) => m.role === 'user')).toBe(true)
  })

  it('sendMessage 发 session.message + 本地 echo 一条 user 消息 + 开新 assistant', async () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.sendMessage('s1', '你好')
    })
    expect(ok).toBe(true)
    expect(send).toHaveBeenCalledWith('session.message', { localSessionId: 's1', text: '你好' })
    // user 消息 echo
    expect(result.current.messages.some((m) => m.role === 'user' && m.text === '你好')).toBe(true)
    expect(result.current.running).toBe(true)
  })

  it('sendMessage 带 permission/thinking 时 → session.message payload 含这些字段', async () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    await act(async () => {
      await result.current.sendMessage('s1', 'hi', { permission: '计划模式', thinking: 'high' })
    })
    expect(send).toHaveBeenCalledWith('session.message', expect.objectContaining({
      localSessionId: 's1',
      text: 'hi',
      permission: '计划模式',
      thinking: 'high',
    }))
  })

  it('sendMessage 不带 opts 时 → payload 只有 localSessionId/text（向后兼容）', async () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    await act(async () => {
      await result.current.sendMessage('s1', 'hi')
    })
    const payload = send.mock.calls[0][1]
    expect(payload).toEqual({ localSessionId: 's1', text: 'hi' })
  })

  it('空文本不发送', async () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.sendMessage('s1', '   ')
    })
    expect(ok).toBe(false)
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

describe('useSessionChat - 编辑重发', () => {
  // 构造已有 user+assistant 消息的会话状态(模拟发过一轮)
  function seedConversation(result: any, messages: any[]) {
    act(() => {
      // 用 sendMessage 预置:echo user + 开 assistant,然后塞入历史 assistant 文本
      // 简化:直接通过 onInbound 历史灌入构造 user/assistant 交替
    })
  }

  it('editAndResend 截断该 index 及之后消息,替换为新文本,发 session.message(不重复echo)', async () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    // 预置:[user "原文", assistant "回复"]
    act(() => {
      const historyEnv: any = {
        v: 1, type: 'session.history', deviceId: 'd', ts: 1, nonce: 'n', sig: '',
        payload: { items: [
          { role: 'assistant', text: '回复' },
          { role: 'user', text: '原文' },
        ] },
      }
      result.current.onInbound(historyEnv)
    })
    expect(result.current.messages.map((m: any) => m.text)).toEqual(['回复', '原文']) // 历史前置

    // 编辑 index 1(最后一条 user "原文"),新文本 "改后的"
    await act(async () => {
      await result.current.editAndResend('s1', 1, '改后的')
    })
    // 截断:user "原文" 被替换为 "改后的",之后的 assistant "回复"... 注意历史前置顺序
    // 历史灌入后 messages = [assistant "回复"(idx0), user "原文"(idx1)],editAndResend(1) 截断 idx1 及之后
    // → [assistant "回复"(idx0)] + 新 user "改后的" + 空 assistant mkMessage
    const texts = result.current.messages.map((m: any) => (m.role === 'user' ? m.text : '(assistant)'))
    expect(texts).toEqual(['(assistant)', '改后的', '(assistant)'])
    // 发了 session.message,文本是改后的
    const lastCall = send.mock.calls[send.mock.calls.length - 1]
    expect(lastCall[0]).toBe('session.message')
    expect(lastCall[1].text).toBe('改后的')
    // 只发了 1 次 session.message(没有重复 echo 导致多次发送)
    const messageCalls = send.mock.calls.filter((c) => c[0] === 'session.message')
    expect(messageCalls.length).toBe(1)
  })

  it('editAndResend 在 running 时先调 interrupt', async () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    // 预置一条 user + 进入 running(模拟流式中)
    act(() => {
      result.current.onInbound({ v: 1, type: 'session.history', deviceId: 'd', ts: 1, nonce: 'n', sig: '', payload: { items: [{ role: 'user', text: '原文' }] } } as any)
    })
    act(() => {
      // session.delta 触发 setRunning(true)
      result.current.onInbound({ v: 1, type: 'session.delta', deviceId: 'd', ts: 1, nonce: 'n', sig: '', payload: { localSessionId: 's1', text: '流式中' } } as any)
    })
    expect(result.current.running).toBe(true)

    await act(async () => {
      await result.current.editAndResend('s1', 0, '改后')
    })
    // running 时应先 interrupt 再 message
    const interruptCall = send.mock.calls.find((c) => c[0] === 'session.interrupt')
    const messageCall = send.mock.calls.find((c) => c[0] === 'session.message')
    expect(interruptCall).toBeTruthy()
    expect(messageCall).toBeTruthy()
    // interrupt 在 message 之前(按调用顺序)
    expect(send.mock.calls.indexOf(interruptCall!)).toBeLessThan(send.mock.calls.indexOf(messageCall!))
  })

  it('editAndResend 空文本不发送', async () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    act(() => {
      result.current.onInbound({ v: 1, type: 'session.history', deviceId: 'd', ts: 1, nonce: 'n', sig: '', payload: { items: [{ role: 'user', text: '原文' }] } } as any)
    })
    await act(async () => {
      await result.current.editAndResend('s1', 0, '   ')
    })
    expect(send).not.toHaveBeenCalled()
  })
})

describe('useSessionChat - 排队模式', () => {
  it('running + queueMode=queue → 消息进队列,不直接 send', async () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    // 先进入 running(模拟流式中)
    act(() => {
      result.current.onInbound({ v: 1, type: 'session.delta', deviceId: 'd', ts: 1, nonce: 'n', sig: '', payload: { localSessionId: 's1', text: '流式中' } } as any)
    })
    expect(result.current.running).toBe(true)
    const sendCallsBefore = send.mock.calls.length
    // queue 模式发送
    await act(async () => {
      await result.current.sendMessage('s1', '排队消息', { queueMode: 'queue' })
    })
    // 进了队列,没有新 session.message 调用
    expect(result.current.queue.map((q: any) => q.text)).toEqual(['排队消息'])
    expect(send.mock.calls.length).toBe(sendCallsBefore) // 无新 send
  })

  it('running + queueMode=queue → 出队时保留 permission/thinking/images', async () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    const images = [{ mediaType: 'image/png', data: 'abc', name: 'a.png' }]
    act(() => {
      result.current.onInbound({ v: 1, type: 'session.delta', deviceId: 'd', ts: 1, nonce: 'n', sig: '', payload: { localSessionId: 's1', text: '流式中' } } as any)
    })
    await act(async () => {
      await result.current.sendMessage('s1', '排队1', { queueMode: 'queue', permission: '完全访问', thinking: 'high', images })
    })

    act(() => {
      result.current.onInbound({ v: 1, type: 'session.result', deviceId: 'd', ts: 1, nonce: 'n', sig: '', payload: { localSessionId: 's1' } } as any)
    })

    expect(send.mock.calls.some((c) => c[0] === 'session.message' && c[1]?.text === '排队1' && c[1]?.permission === '完全访问' && c[1]?.thinking === 'high' && c[1]?.images === images)).toBe(true)
  })

  it('running + queueMode=guide → interrupt 后 200ms 发', async () => {
    vi.useFakeTimers()
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    act(() => {
      result.current.onInbound({ v: 1, type: 'session.delta', deviceId: 'd', ts: 1, nonce: 'n', sig: '', payload: { localSessionId: 's1', text: '流式中' } } as any)
    })
    await act(async () => {
      await result.current.sendMessage('s1', '立即发', { queueMode: 'guide' })
    })
    // 应已 interrupt(session.interrupt 调用)
    expect(send.mock.calls.some((c) => c[0] === 'session.interrupt')).toBe(true)
    // 200ms 前还没发 session.message(只有 interrupt)
    const msgBefore = send.mock.calls.filter((c) => c[0] === 'session.message').length
    // 推进 200ms
    act(() => { vi.advanceTimersByTime(200) })
    const msgAfter = send.mock.calls.filter((c) => c[0] === 'session.message').length
    expect(msgAfter).toBeGreaterThan(msgBefore) // 200ms 后发了 message
    vi.useRealTimers()
  })

  it('running + queueMode=guide → 200ms 后发送保留 permission/thinking/images', async () => {
    vi.useFakeTimers()
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    const images = [{ mediaType: 'image/png', data: 'abc', name: 'a.png' }]
    act(() => {
      result.current.onInbound({ v: 1, type: 'session.delta', deviceId: 'd', ts: 1, nonce: 'n', sig: '', payload: { localSessionId: 's1', text: '流式中' } } as any)
    })
    await act(async () => {
      await result.current.sendMessage('s1', '立即发', { queueMode: 'guide', permission: '计划模式', thinking: 'low', images })
    })
    act(() => { vi.advanceTimersByTime(200) })
    expect(send.mock.calls.some((c) => c[0] === 'session.message' && c[1]?.text === '立即发' && c[1]?.permission === '计划模式' && c[1]?.thinking === 'low' && c[1]?.images === images)).toBe(true)
    vi.useRealTimers()
  })

  it('!running → 直接发(不受 queueMode 影响)', async () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    await act(async () => {
      await result.current.sendMessage('s1', '直接发', { queueMode: 'queue' })
    })
    expect(send.mock.calls.some((c) => c[0] === 'session.message')).toBe(true)
    expect(result.current.queue).toEqual([]) // 没进队列
  })

  it('running 结束 + queue 非空 → 自动发队首 + 出队', async () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    act(() => {
      result.current.onInbound({ v: 1, type: 'session.delta', deviceId: 'd', ts: 1, nonce: 'n', sig: '', payload: { localSessionId: 's1', text: '流式中' } } as any)
    })
    await act(async () => {
      await result.current.sendMessage('s1', '排队1', { queueMode: 'queue' })
    })
    expect(result.current.queue.map((q: any) => q.text)).toEqual(['排队1'])
    // AI 结束(session.result → running:false)
    act(() => {
      result.current.onInbound({ v: 1, type: 'session.result', deviceId: 'd', ts: 1, nonce: 'n', sig: '', payload: { localSessionId: 's1' } } as any)
    })
    // 自动出队:queue 清空,发了队首
    expect(result.current.queue).toEqual([])
    expect(send.mock.calls.some((c) => c[0] === 'session.message' && c[1]?.text === '排队1')).toBe(true)
  })
})

describe('useSessionChat - 系统提示', () => {
  it('session.notice 追加为 notice 消息', () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    act(() => {
      result.current.onInbound({
        v: 1, type: 'session.notice', deviceId: 'd', ts: 1, nonce: 'n', sig: '',
        payload: { localSessionId: 's1', text: 'API 重试中', level: 'warn' },
      } as any)
    })
    expect(result.current.messages).toContainEqual(expect.objectContaining({
      role: 'notice',
      text: 'API 重试中',
      level: 'warn',
    }))
  })
})

describe('useSessionChat - subagent 分流', () => {
  it('带 payload.toolUseId 的 tool_use_start 归 subagentOutput,不污染主流 blocks', () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    act(() => {
      // subagent-output 转发的信封:op=tool_use_start + toolUseId(父 Task id)
      result.current.onInbound({
        v: 1, type: 'session.blocks', deviceId: 'd', ts: 1, nonce: 'n', sig: '',
        payload: { localSessionId: 's1', op: 'tool_use_start', toolUseId: 'task-1', block: { type: 'tool_use', id: 'inner-bash', name: 'Bash', input: { command: 'ls' } } },
      } as any)
    })
    // 子代理块单独到达时不创建主流消息(分流 return,不进 blocks)
    const blocks = (result.current.messages[0] as any)?.blocks ?? []
    expect(blocks.some((b: any) => b.id === 'inner-bash')).toBe(false)
    // subagentOutput 按父 Task id 聚合
    expect(result.current.subagentOutput['task-1']?.some((b: any) => b.label === 'Bash: ls')).toBe(true)
  })

  it('主流 tool_use_start(无 payload.toolUseId)正常进 blocks,不进 subagentOutput', () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    act(() => {
      result.current.onInbound({
        v: 1, type: 'session.blocks', deviceId: 'd', ts: 1, nonce: 'n', sig: '',
        payload: { localSessionId: 's1', op: 'tool_use_start', block: { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/a' } } },
      } as any)
    })
    const m = result.current.messages[0] as any
    expect(m?.blocks?.some((b: any) => b.id === 'tu1')).toBe(true)
    expect(Object.keys(result.current.subagentOutput)).toHaveLength(0)
  })
})
