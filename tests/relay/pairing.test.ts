import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('pairing 配对码', () => {
  beforeEach(() => vi.useFakeTimers())

  it('issueCode 返回 6 位数字码与 60s 过期时间', async () => {
    const { createPairingStore } = await import('../../relay/pairing')
    const store = createPairingStore(makeFakeBindings())
    const r = store.issueCode('D')
    expect(r.code).toMatch(/^\d{6}$/)
    expect(r.expiresAt).toBe(Date.now() + 60_000)
  })

  it('consume 成功返回 desktopId 并落绑定，码一次性', async () => {
    const { createPairingStore } = await import('../../relay/pairing')
    const bindings = makeFakeBindings()
    const store = createPairingStore(bindings)
    const { code } = store.issueCode('D')
    const r = store.consume(code, 'M')
    expect(r?.desktopId).toBe('D')
    expect(bindings.addBinding).toHaveBeenCalledWith('D', 'M')
    // 第二次用同一码失败
    expect(store.consume(code, 'M2')).toBeNull()
  })

  it('过期码 consume 返回 null', async () => {
    const { createPairingStore } = await import('../../relay/pairing')
    const store = createPairingStore(makeFakeBindings())
    const { code } = store.issueCode('D')
    vi.advanceTimersByTime(61_000)
    expect(store.consume(code, 'M')).toBeNull()
  })

  it('限频：同 deviceId 60s 内 issue 超过上限抛错', async () => {
    const { createPairingStore } = await import('../../relay/pairing')
    const store = createPairingStore(makeFakeBindings(), { maxIssuePerWindow: 3 })
    store.issueCode('D'); store.issueCode('D'); store.issueCode('D')
    expect(() => store.issueCode('D')).toThrow()
  })
})

function makeFakeBindings() {
  return { addBinding: vi.fn(), removeBinding: vi.fn(), getPeer: vi.fn(), has: vi.fn(() => true) } as any
}
