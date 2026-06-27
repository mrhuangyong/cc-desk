import { describe, it, expect, vi } from 'vitest'

describe('dialog 断线补发', () => {
  it('enqueue 登记，replayFor 重发所有未取消的', async () => {
    const { createDialogReplayer } = await import('../src/main/remote-bridge')
    const sent: any[] = []
    const r = createDialogReplayer((env) => sent.push(env))
    r.enqueue('r1', { type: 'dialog.request', payload: { reqId: 'r1' } } as any)
    r.enqueue('r2', { type: 'dialog.request', payload: { reqId: 'r2' } } as any)
    r.replayFor('M')
    expect(sent).toHaveLength(2)
  })

  it('cancel 后 replayFor 不再补发该请求', async () => {
    const { createDialogReplayer } = await import('../src/main/remote-bridge')
    const sent: any[] = []
    const r = createDialogReplayer((env) => sent.push(env))
    r.enqueue('r1', { type: 'dialog.request', payload: { reqId: 'r1' } } as any)
    r.cancel('r1')
    r.replayFor('M')
    expect(sent).toHaveLength(0)
  })

  it('cleanupExpired 移除超过 24h 的登记', async () => {
    const { createDialogReplayer } = await import('../src/main/remote-bridge')
    const sent: any[] = []
    const r = createDialogReplayer((env) => sent.push(env))
    r.enqueue('r1', { type: 'dialog.request', payload: { reqId: 'r1' } } as any)
    // 未过期前 replayFor 会补发
    r.replayFor('M')
    expect(sent).toHaveLength(1)
    sent.length = 0
    // 模拟过期（实现用 Date.now()，测试用 vi.setSystemTime 控制）
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 25 * 3600_000)
    r.cleanupExpired()
    r.replayFor('M')
    // 过期登记已被清理，不再补发
    expect(sent).toHaveLength(0)
    vi.useRealTimers()
  })

  it('cancel 不存在的 reqId 是无害的 noop', async () => {
    const { createDialogReplayer } = await import('../src/main/remote-bridge')
    const r = createDialogReplayer(() => {})
    expect(() => r.cancel('nonexistent')).not.toThrow()
  })

  it('replayFor 对空登记不发任何消息', async () => {
    const { createDialogReplayer } = await import('../src/main/remote-bridge')
    const sent: any[] = []
    const r = createDialogReplayer((env) => sent.push(env))
    r.replayFor('M')
    expect(sent).toHaveLength(0)
  })
})
