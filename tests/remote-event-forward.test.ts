// tests/remote-event-forward.test.ts
// Task 10: 出站事件旁路转发 —— 桌面 claude:* IPC 事件 → 协议消息映射。
//
// 设计要点：forwarder 产出「待签名」信封（sig/deviceId/ts/nonce 占位），
// 由 remote-bridge 的 send 统一用 makeEnvelope 重签后发中继。
// 因此本测试只验证 type/payload 映射，不依赖密钥。
import { describe, it, expect, vi } from 'vitest'

describe('出站事件转发 createEventForwarder', () => {
  it('delta(text) 事件 → session.delta 协议消息（payload.text）', async () => {
    const { createEventForwarder } = await import('../src/main/remote-bridge')
    const sent: any[] = []
    const fwd = createEventForwarder((env) => sent.push(env))
    fwd.onClaudeDelta({ kind: 'text', delta: 'hi', localSessionId: 's1' })
    expect(sent).toHaveLength(1)
    expect(sent[0].type).toBe('session.delta')
    expect(sent[0].payload).toMatchObject({ text: 'hi', localSessionId: 's1' })
    // 占位字段（由外层 send 重签）
    expect(sent[0].sig).toBe('')
    expect(sent[0].deviceId).toBe('')
  })

  it('delta(thinking) 事件 → session.delta 协议消息（payload.thinking）', async () => {
    const { createEventForwarder } = await import('../src/main/remote-bridge')
    const sent: any[] = []
    const fwd = createEventForwarder((env) => sent.push(env))
    fwd.onClaudeDelta({ kind: 'thinking', delta: '思考中', localSessionId: 's2' })
    expect(sent[0].type).toBe('session.delta')
    expect(sent[0].payload).toMatchObject({ thinking: '思考中', localSessionId: 's2' })
  })

  it('blocks 事件 → session.blocks 协议消息（payload 透传）', async () => {
    const { createEventForwarder } = await import('../src/main/remote-bridge')
    const sent: any[] = []
    const fwd = createEventForwarder((env) => sent.push(env))
    const data = { localSessionId: 's1', blockType: 'tool_use_start', content: { id: 't1' } }
    fwd.onClaudeBlocks(data)
    expect(sent[0].type).toBe('session.blocks')
    expect(sent[0].payload).toBe(data)
  })

  it('notice 事件 → session.notice 协议消息', async () => {
    const { createEventForwarder } = await import('../src/main/remote-bridge')
    const sent: any[] = []
    const fwd = createEventForwarder((env) => sent.push(env))
    const data = { localSessionId: 's1', level: 'warn', message: '权限提示' }
    fwd.onNotice(data)
    expect(sent[0].type).toBe('session.notice')
    expect(sent[0].payload).toBe(data)
  })

  it('result 事件 → session.result 协议消息', async () => {
    const { createEventForwarder } = await import('../src/main/remote-bridge')
    const sent: any[] = []
    const fwd = createEventForwarder((env) => sent.push(env))
    const data = { localSessionId: 's1', costUsd: 0.01, durationMs: 1234 }
    fwd.onResult(data)
    expect(sent[0].type).toBe('session.result')
    expect(sent[0].payload).toBe(data)
  })

  it('dialog-request 事件 → dialog.request 协议消息 + enqueue 到 replayer', async () => {
    const { createEventForwarder } = await import('../src/main/remote-bridge')
    const sent: any[] = []
    const enqueue = vi.fn()
    const fwd = createEventForwarder((env) => sent.push(env), { enqueueDialog: enqueue })
    const data = { reqId: 'r1', localSessionId: 's1', dialogKind: 'plan', payload: { summary: '...' } }
    fwd.onDialogRequest(data)
    expect(sent).toHaveLength(1)
    expect(sent[0].type).toBe('dialog.request')
    expect(sent[0].payload).toBe(data)
    // 同步登记到 replayer（断线重连补发）
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenCalledWith('r1', sent[0])
  })

  it('未提供 enqueueDialog 选项时不报错（兼容仅转发场景）', async () => {
    const { createEventForwarder } = await import('../src/main/remote-bridge')
    const sent: any[] = []
    const fwd = createEventForwarder((env) => sent.push(env))
    expect(() =>
      fwd.onDialogRequest({ reqId: 'r2', localSessionId: 's1', dialogKind: 'ask', payload: {} }),
    ).not.toThrow()
    expect(sent[0].type).toBe('dialog.request')
  })
})
