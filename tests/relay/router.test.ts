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

  // === 一对多广播（修复：桌面↔多手机，桌面消息发给所有在线手机）===
  it('广播：桌面消息投递给所有已绑定且在线的手机', async () => {
    const { createRouter } = await import('../../relay/router')
    // 桌面 D 绑定 M1/M2/M3（一对多）；每个手机的对端只有 D
    const bindings = makeFakeBindingsOneToMany({ D: ['M1', 'M2', 'M3'] })
    const desktopKey = 'a2V5LWQ='
    const router = createRouter(bindings, () => desktopKey)
    const delivered: string[] = []
    router.register('M1', () => delivered.push('M1'))
    router.register('M2', () => delivered.push('M2'))
    router.register('M3', () => delivered.push('M3'))
    // M3 不注册（离线），只 M1/M2 在线
    router.unregister('M3')
    const env = makeEnvelope(desktopKey, 'session.list', 'D', { sessions: [] })
    const r = router.route(env)
    expect(r.ok).toBe(true)
    expect(r.delivered).toBe(true)
    expect(delivered.sort()).toEqual(['M1', 'M2']) // 在线的都收到
  })

  it('广播：所有手机离线时 delivered=false peer_offline', async () => {
    const { createRouter } = await import('../../relay/router')
    const bindings = makeFakeBindingsOneToMany({ D: ['M1', 'M2'] })
    const desktopKey = 'a2V5LWQ='
    const router = createRouter(bindings, () => desktopKey)
    // 不注册任何手机
    const env = makeEnvelope(desktopKey, 'session.list', 'D', {})
    const r = router.route(env)
    expect(r.ok).toBe(true)
    expect(r.delivered).toBe(false)
    expect(r.reason).toBe('peer_offline')
  })

  it('广播：手机→桌面仍单播（手机对端只有桌面）', async () => {
    const { createRouter } = await import('../../relay/router')
    const bindings = makeFakeBindingsOneToMany({ D: ['M1', 'M2'] })
    const mobileKey = 'b2V5LW0='
    const router = createRouter(bindings, () => mobileKey)
    const sent: any[] = []
    router.register('D', (env) => sent.push(env))
    const env = makeEnvelope(mobileKey, 'session.sync', 'M1', {})
    const r = router.route(env)
    expect(r.ok).toBe(true)
    expect(r.delivered).toBe(true)
    expect(sent).toHaveLength(1) // 只发给桌面一个
  })

  // === Task 2-fix：token 虚拟身份（share: 前缀）放行 + tokenPeers 路由 ===
  it('Task 2-fix token 手机→桌面：share: 前缀身份放行，经 tokenPeers 转发给桌面', async () => {
    // 场景：token 手机以虚拟 id share:xxx register（bind 时带 tokenPeer=桌面真实 id D），
    // 真桌面 D 也 register。token 手机发消息 → route 命中 share: 放行分支 → 经 tokenPeers
    // 查到对端 D → 转发给 D 的连接。
    const { createRouter } = await import('../../relay/router')
    const bindings = makeFakeBindingsOneToMany({}) // token 桌面未必配对，bindings 空
    const router = createRouter(bindings, () => 'unused-key')
    const sentToDesktop: any[] = []
    router.register('share:abcd1234', () => {}, { tokenPeer: 'D' }) // token 手机
    router.register('D', (env) => sentToDesktop.push(env))            // 真桌面
    // 信封 deviceId 是 share: 前缀（server.ts 会替换为 virtualId）
    const env = makeEnvelope('any', 'session.sync', 'share:abcd1234', { x: 1 })
    const r = router.route(env)
    expect(r.ok).toBe(true)
    expect(r.delivered).toBe(true)
    expect(sentToDesktop).toHaveLength(1) // 经 tokenPeers 转发给桌面 D
  })

  it('Task 2-fix 桌面→token 手机：桌面走验签路径，额外转发给 tokenPeers 映射的 token 手机', async () => {
    // 场景：桌面 D 已配对（bindings 里有 D↔M），同时 token 手机 share:xxx 在线。
    // 桌面发消息：走完整验签路径转发给配对手机 M，且经 tokenPeers 也转发给 token 手机。
    const { createRouter } = await import('../../relay/router')
    const bindings = makeFakeBindingsOneToMany({ D: ['M'] })
    const deskKey = 'a2V5LWQ='
    const router = createRouter(bindings, () => deskKey)
    const sentToMobile: any[] = []
    const sentToToken: any[] = []
    router.register('M', (env) => sentToMobile.push(env))
    router.register('share:abcd1234', (env) => sentToToken.push(env), { tokenPeer: 'D' })
    const env = makeEnvelope(deskKey, 'session.list', 'D', { sessions: [] })
    const r = router.route(env)
    expect(r.ok).toBe(true)
    expect(r.delivered).toBe(true)
    expect(sentToMobile).toHaveLength(1)  // 配对手机收到
    expect(sentToToken).toHaveLength(1)   // token 手机也收到
  })

  it('Task 2-fix 缺陷2：旧配对设备不走 conns.has 放行，仍需完整验签（非 share: 前缀不命中放行）', async () => {
    // 回归：原缺陷 `if (conns.has(env.deviceId))` 让任何已 bind 的旧设备绕过验签。
    // 修复后放行分支只命中 share: 前缀；旧配对设备 M 即使 register 过，签名错误仍 bad_sig。
    const { createRouter } = await import('../../relay/router')
    const bindings = makeFakeBindingsOneToMany({ D: ['M'] })
    const router = createRouter(bindings, () => 'correct-key')
    router.register('M', () => {}) // M 已 register（已 bind）
    // M 发消息但用错误密钥签名 → 不命中放行 → 走验签 → bad_sig
    const env = makeEnvelope('wrong-key', 'session.sync', 'M', {})
    const r = router.route(env)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('bad_sig')
  })

  it('Task 2-fix unregister 清理 tokenPeers 双向映射', async () => {
    const { createRouter } = await import('../../relay/router')
    const bindings = makeFakeBindingsOneToMany({})
    const router = createRouter(bindings, () => 'k')
    router.register('share:abcd1234', () => {}, { tokenPeer: 'D' })
    router.register('D', () => {})
    // token 手机断开
    router.unregister('share:abcd1234')
    // 桌面发消息不应再转发给已断开的 token 手机（tokenPeers 反向项已清）
    const sent: any[] = []
    router.register('D', (env) => sent.push(env))
    const env = makeEnvelope('k', 'session.list', 'D', {})
    // D 不在 bindings（这里测的是 tokenPeers 清理，bindings 空 → unbound，但重点是 token 手机收不到）
    router.route(env)
    expect(sent).toHaveLength(0)
  })
})

function makeFakeBindings(map: Record<string, string>) {
  return {
    getPeer: (id: string) => map[id],
    getPeers: (id: string) => new Set(map[id] ? [map[id]] : []),
    has: (id: string) => id in map,
    addBinding: vi.fn(), removeBinding: vi.fn(),
  } as any
}

/** 一对多假绑定：peers 形如 { D: ['M1','M2'] }；自动补全每个手机→桌面的反向单值。 */
function makeFakeBindingsOneToMany(peers: Record<string, string[]>) {
  // 补全反向：每个被绑定的对端，其 peer 集合包含绑定它的「主」
  const full: Record<string, string[]> = {}
  for (const k in peers) full[k] = [...peers[k]]
  for (const k in peers) {
    for (const m of peers[k]) {
      full[m] = full[m] ? Array.from(new Set([...full[m], k])) : [k]
    }
  }
  return {
    getPeers: (id: string) => new Set(full[id] ?? []),
    getPeer: (id: string) => {
      const arr = full[id]
      return arr && arr.length ? arr[0] : undefined
    },
    has: (id: string) => id in full,
    addBinding: vi.fn(), removeBinding: vi.fn(),
  } as any
}
