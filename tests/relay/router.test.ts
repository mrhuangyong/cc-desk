// tests/relay/router.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { makeEnvelope } from '../../src/shared/remote-protocol'

describe('router 路由转发', () => {
  it('已绑定设备签名合法的消息转发给对端', async () => {
    const { createRouter } = await import('../../relay/router')
    const bindings = makeFakeBindings({ 'D': 'M', 'M': 'D' })
    const desktopKey = 'a2V5LWQ='
    const router = createRouter(bindings, () => desktopKey) // 注入查密钥函数
    const sentToMobile: any[] = []
    router.register('D', (env) => {}) // 桌面在线但不接收本条
    router.register('M', (env) => sentToMobile.push(env))
    const env = makeEnvelope(desktopKey, 'session.delta', 'D', { text: 'hi' })
    const r = router.route(env)
    expect(r.ok).toBe(true)
    expect(sentToMobile).toHaveLength(1)
  })

  it('未绑定设备 route 失败（unbound）', async () => {
    const { createRouter } = await import('../../relay/router')
    const bindings = makeFakeBindings({})
    const router = createRouter(bindings, () => 'k')
    const env = makeEnvelope('k', 'session.delta', 'X', {})
    expect(router.route(env).ok).toBe(false)
  })

  it('签名错误 route 失败（bad_sig）', async () => {
    const { createRouter } = await import('../../relay/router')
    const bindings = makeFakeBindings({ 'D': 'M' })
    const router = createRouter(bindings, () => 'correct-key')
    const env = makeEnvelope('wrong-key', 'session.delta', 'D', {})
    expect(router.route(env).reason).toBe('bad_sig')
  })

  it('对端不在线返回 peer_offline', async () => {
    const { createRouter } = await import('../../relay/router')
    const bindings = makeFakeBindings({ 'D': 'M' })
    const router = createRouter(bindings, () => 'k')
    router.register('D', () => {})
    const env = makeEnvelope('k', 'session.delta', 'D', {})
    const r = router.route(env)
    expect(r.ok).toBe(true)
    expect(r.delivered).toBe(false) // peer M 未注册
  })

  it('I2 seen 集合有上限：超过 cap 后旧 nonce 被驱逐（防内存泄漏 OOM）', async () => {
    const { createRouter } = await import('../../relay/router')
    const bindings = makeFakeBindings({ 'D': 'M', 'M': 'D' })
    const desktopKey = 'a2V5LWQ='
    const router = createRouter(bindings, () => desktopKey, { seenCap: 100 })
    router.register('M', () => {})
    // 注入 200 条不同 nonce 的合法消息（远超 cap=100）
    for (let i = 0; i < 200; i++) {
      router.route(makeEnvelope(desktopKey, 'session.delta', 'D', { i }))
    }
    // 内部 seen 不应超过 cap（通过私有方法观测，若无可观测接口则靠不会无限增长的隐式保证）
    expect((router as any).seenSize?.()).toBeLessThanOrEqual(200)
    // 关键回归：cap 触发清理后，集合大小被收敛到 cap 附近，而非线性增长到 200
    expect((router as any).seenSize?.()).toBeLessThanOrEqual(100 + 50) // 容忍清理粒度
  })

  it('I2 seen 集合定期清旧：超过 nonce TTL 窗口的 nonce 被删（防泄漏）', async () => {
    const { createRouter } = await import('../../relay/router')
    vi.useFakeTimers()
    const bindings = makeFakeBindings({ 'D': 'M', 'M': 'D' })
    const desktopKey = 'a2V5LWQ='
    const router = createRouter(bindings, () => desktopKey, { seenTtlMs: 120_000, cleanupIntervalMs: 5_000 })
    router.register('M', () => {})
    router.route(makeEnvelope(desktopKey, 'session.delta', 'D', { x: 1 }))
    const sizeAfter1 = (router as any).seenSize?.() ?? 0
    expect(sizeAfter1).toBeGreaterThan(0)
    // 快进 3 分钟（超过 TTL），触发一次 route 让清理跑
    vi.advanceTimersByTime(3 * 60_000)
    router.route(makeEnvelope(desktopKey, 'session.delta', 'D', { x: 2 }))
    // 旧 nonce 应被清理；当前只剩最新一条
    const sizeAfter = (router as any).seenSize?.() ?? 0
    expect(sizeAfter).toBeLessThanOrEqual(2)
    vi.useRealTimers()
  })
})

function makeFakeBindings(map: Record<string, string>) {
  return {
    getPeer: (id: string) => map[id],
    has: (id: string) => id in map,
    addBinding: vi.fn(), removeBinding: vi.fn(),
  } as any
}
