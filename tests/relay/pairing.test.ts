import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PairingStore } from '../../relay/pairing'

type ConsumeResult = ReturnType<PairingStore['consumeAttempt']>
/** 取 reason（仅在 ok=false 分支存在）；TS 对判别联合需显式收窄。 */
function reasonOf(r: ConsumeResult): string | null {
  return r.ok ? null : r.reason
}
/** 取 desktopId（仅在 ok=true 分支存在）。 */
function desktopIdOf(r: ConsumeResult): string | null {
  return r.ok ? r.desktopId : null
}

describe('pairing 配对码', () => {
  beforeEach(() => vi.useFakeTimers())

  it('issueCode 返回 6 位数字码与 60s 过期时间', async () => {
    const { createPairingStore } = await import('../../relay/pairing')
    const store = createPairingStore(makeFakeBindings())
    const r = store.issueCode('D')
    expect(r.code).toMatch(/^\d{6}$/)
    expect(r.expiresAt).toBe(Date.now() + 60_000)
  })

  it('consumeAttempt 成功返回 desktopId 并落绑定，码一次性', async () => {
    const { createPairingStore } = await import('../../relay/pairing')
    const bindings = makeFakeBindings()
    const store = createPairingStore(bindings)
    const { code } = store.issueCode('D')
    const r = store.consumeAttempt('127.0.0.1', code, 'M')
    expect(r.ok).toBe(true)
    expect(desktopIdOf(r)).toBe('D')
    expect(bindings.addBinding).toHaveBeenCalledWith('D', 'M')
    // 第二次用同一码失败（已一次性删除）
    const r2 = store.consumeAttempt('127.0.0.1', code, 'M2')
    expect(r2.ok).toBe(false)
    expect(reasonOf(r2)).toBe('bad_code')
  })

  it('过期码 consume 返回 bad_code', async () => {
    const { createPairingStore } = await import('../../relay/pairing')
    const store = createPairingStore(makeFakeBindings())
    const { code } = store.issueCode('D')
    vi.advanceTimersByTime(61_000)
    const r = store.consumeAttempt('127.0.0.1', code, 'M')
    expect(r.ok).toBe(false)
    expect(reasonOf(r)).toBe('bad_code')
  })

  it('限频：同 deviceId 60s 内 issue 超过上限抛错', async () => {
    const { createPairingStore } = await import('../../relay/pairing')
    const store = createPairingStore(makeFakeBindings(), { maxIssuePerWindow: 3 })
    store.issueCode('D'); store.issueCode('D'); store.issueCode('D')
    expect(() => store.issueCode('D')).toThrow()
  })

  it('consume 不再从 PairingStore 直接调用（已废弃，改用 consumeAttempt 以启用 IP 限频）', async () => {
    // 旧 consume(code, mobileId) 不带 IP 维度，无法防暴力枚举，已删除。
    // 新契约：consumeAttempt(ip, code, mobileId)。
    const { createPairingStore } = await import('../../relay/pairing')
    const store = createPairingStore(makeFakeBindings())
    expect(typeof (store as any).consumeAttempt).toBe('function')
    expect((store as any).consume).toBeUndefined()
  })

  it('C1 consumeAttempt：同 IP 超过上限（默认 10/分）后被拒（rate_limited）', async () => {
    const { createPairingStore } = await import('../../relay/pairing')
    // lockThreshold 拉高以隔离限频维度（不与锁定耦合）
    const store = createPairingStore(makeFakeBindings(), { maxConsumePerIp: 5, lockThreshold: 100 })
    // 前 5 次用错误码 consume（都失败但消耗配额）
    for (let i = 0; i < 5; i++) {
      const r = store.consumeAttempt('1.2.3.4', '00000' + i, 'M')
      expect(reasonOf(r)).toBe('bad_code')
    }
    // 第 6 次被限频
    const r = store.consumeAttempt('1.2.3.4', '111111', 'M')
    expect(r.ok).toBe(false)
    expect(reasonOf(r)).toBe('rate_limited')
  })

  it('C1 consumeAttempt：不同 IP 各自有独立配额', async () => {
    const { createPairingStore } = await import('../../relay/pairing')
    const store = createPairingStore(makeFakeBindings(), { maxConsumePerIp: 3 })
    for (let i = 0; i < 3; i++) store.consumeAttempt('1.1.1.1', '00000' + i, 'M')
    // IP 1 已耗尽，但 IP 2 仍可用
    const r2 = store.consumeAttempt('2.2.2.2', '999999', 'M')
    expect(r2.ok).toBe(false)
    expect(reasonOf(r2)).toBe('bad_code') // 非 rate_limited
  })

  it('C1 consumeAttempt：失败次数达阈值后锁定该 IP（locked）', async () => {
    const { createPairingStore } = await import('../../relay/pairing')
    // lockThreshold=4 语义：第 4 次失败即触发锁定（fails >= threshold）
    const store = createPairingStore(makeFakeBindings(), {
      maxConsumePerIp: 20, lockThreshold: 4, lockMs: 30_000,
    })
    // 前 3 次失败返回 bad_code
    for (let i = 0; i < 3; i++) {
      const r = store.consumeAttempt('9.9.9.9', '00000' + i, 'M')
      expect(reasonOf(r)).toBe('bad_code')
    }
    // 第 4 次失败触发锁定（返回 locked）
    const r = store.consumeAttempt('9.9.9.9', '123456', 'M')
    expect(r.ok).toBe(false)
    expect(reasonOf(r)).toBe('locked')
  })

  it('C1 consumeAttempt：锁定到期后恢复配额', async () => {
    const { createPairingStore } = await import('../../relay/pairing')
    const store = createPairingStore(makeFakeBindings(), {
      maxConsumePerIp: 20, lockThreshold: 2, lockMs: 10_000,
    })
    store.consumeAttempt('8.8.8.8', '000000', 'M')
    store.consumeAttempt('8.8.8.8', '000001', 'M') // 第2次失败 → 锁定
    const locked = store.consumeAttempt('8.8.8.8', '000002', 'M')
    expect(reasonOf(locked)).toBe('locked')
    vi.advanceTimersByTime(10_001)
    // 锁定到期，配额重置，可继续（但码仍错 → bad_code，非 locked/rate_limited）
    const after = store.consumeAttempt('8.8.8.8', '000003', 'M')
    expect(reasonOf(after)).toBe('bad_code')
  })

  it('C1 consumeAttempt：正确码命中后返回 desktopId 并落绑定（一次性码）', async () => {
    const { createPairingStore } = await import('../../relay/pairing')
    const bindings = makeFakeBindings()
    const store = createPairingStore(bindings)
    const { code } = store.issueCode('D')
    const r = store.consumeAttempt('7.7.7.7', code, 'M')
    expect(r.ok).toBe(true)
    expect(desktopIdOf(r)).toBe('D')
    expect(bindings.addBinding).toHaveBeenCalledWith('D', 'M')
    // 码一次性：再用失败
    const r2 = store.consumeAttempt('7.7.7.7', code, 'M')
    expect(r2.ok).toBe(false)
  })
})

function makeFakeBindings() {
  return { addBinding: vi.fn(), removeBinding: vi.fn(), getPeer: vi.fn(), has: vi.fn(() => true) } as any
}
