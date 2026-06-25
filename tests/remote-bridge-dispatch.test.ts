// tests/remote-bridge-dispatch.test.ts
// Task 8: 入站命令分发（手机→桌面）。
// 验证 createDispatcher 把手机命令白名单分发到对应的桌面 API。
import { describe, it, expect, vi } from 'vitest'

describe('remote-bridge 入站分发', () => {
  it('session.message → 调 send({prompt, localSessionId})', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const send = vi.fn().mockResolvedValue(undefined)
    const dispatch = createDispatcher({ send, interrupt: vi.fn(), resolveDialog: vi.fn() })
    await dispatch({ type: 'session.message', deviceId: 'M', payload: { localSessionId: 's1', text: 'hi' } } as any)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'hi', localSessionId: 's1' }))
  })

  it('session.interrupt → 调 interrupt(localSessionId)', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const interrupt = vi.fn()
    const dispatch = createDispatcher({ send: vi.fn(), interrupt, resolveDialog: vi.fn() })
    await dispatch({ type: 'session.interrupt', deviceId: 'M', payload: { localSessionId: 's1' } } as any)
    expect(interrupt).toHaveBeenCalledWith('s1')
  })

  it('dialog.response → 调 resolveDialog(reqId, result)', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const resolveDialog = vi.fn()
    const dispatch = createDispatcher({ send: vi.fn(), interrupt: vi.fn(), resolveDialog })
    await dispatch({ type: 'dialog.response', deviceId: 'M', payload: { reqId: 'r1', result: { ok: true } } } as any)
    expect(resolveDialog).toHaveBeenCalledWith('r1', { ok: true })
  })

  it('未知 type 不抛错（静默忽略）', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const dispatch = createDispatcher({ send: vi.fn(), interrupt: vi.fn(), resolveDialog: vi.fn() })
    await expect(dispatch({ type: 'unknown.type', deviceId: 'M', payload: {} } as any)).resolves.not.toThrow()
  })
})
